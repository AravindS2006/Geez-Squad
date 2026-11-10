// Backup and restore rehearsal for the PostgreSQL database.
//
//   RESTORE_SOURCE_URL=<direct URL of the database to back up>
//   RESTORE_TARGET_URL=<URL of a separate, empty database>
//   node scripts/rehearse-restore.mjs --dump <path ending in .dump>
//
// It takes a pg_dump custom-format backup of the source, restores it into the empty target
// and compares exact row counts for every table in the public schema. It never writes to
// the source and never prints connection strings or passwords. pg_dump, pg_restore and psql
// are used from PATH when present, otherwise from the RESTORE_PG_IMAGE Docker image
// (default postgres:17-alpine; its major version must be at least the server's).
// Runbook: docs/OPERATIONS.md, "Backup and restore".
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const image = process.env.RESTORE_PG_IMAGE || 'postgres:17-alpine';

class RehearsalError extends Error {}
function fail(message) {
  throw new RehearsalError(message);
}

/** Parse a URL into libpq environment variables so no secret appears in process arguments. */
export function libpqEnv(name, value) {
  let url;
  try {
    url = new URL(value ?? '');
  } catch {
    fail(`${name} must be a PostgreSQL connection URL.`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    fail(`${name} must be a PostgreSQL connection URL.`);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!url.hostname || !database) fail(`${name} must name a host and a database.`);
  if (/-pooler\./i.test(url.hostname))
    fail(`${name} points at a pooled endpoint; use the direct (unpooled) connection.`);
  const env = {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
  };
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  const binding = url.searchParams.get('channel_binding');
  if (binding) env.PGCHANNELBINDING = binding;
  return env;
}

const sameDatabase = (a, b) =>
  a.PGHOST.toLowerCase() === b.PGHOST.toLowerCase() &&
  a.PGPORT === b.PGPORT &&
  a.PGDATABASE === b.PGDATABASE;

const local = (host) => ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase());
const onPath = ['pg_dump', 'pg_restore', 'psql'].every(
  (bin) => spawnSync(bin, ['--version'], { windowsHide: true }).status === 0,
);

/** Run a PostgreSQL client tool with credentials passed only through the environment. */
function pg(bin, args, connection, { input, mount } = {}) {
  const secrets = [connection.PGPASSWORD].filter(Boolean);
  let result;
  if (onPath) {
    result = spawnSync(
      bin,
      args.map((a) => a.replace('/backup/', `${mount}/`)),
      {
        env: { ...process.env, ...connection },
        input,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } else {
    // Inside the container, the host's loopback is reachable as host.docker.internal.
    const env = {
      ...connection,
      PGHOST: local(connection.PGHOST) ? 'host.docker.internal' : connection.PGHOST,
    };
    result = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--interactive',
        '--add-host=host.docker.internal:host-gateway',
        ...(mount ? ['--volume', `${mount}:/backup`] : []),
        ...Object.keys(env).flatMap((key) => ['--env', key]),
        image,
        bin,
        ...args,
      ],
      {
        env: { ...process.env, ...env },
        input,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  }
  if (result.error || result.status !== 0) {
    let detail = `${result.stderr || result.error?.message || ''}`.trim();
    for (const secret of secrets) detail = detail.replaceAll(secret, '***');
    fail(`${bin} failed${detail ? `:\n${detail.split('\n').slice(-8).join('\n')}` : '.'}`);
  }
  return result.stdout.trim();
}

const countSql = `SELECT c.relname || '|' || (xpath('/row/n/text()', query_to_xml(
  format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1;`;

/** @returns {Map<string, number>} exact row count per public table */
function counts(connection) {
  const rows = pg(
    'psql',
    ['--no-psqlrc', '--tuples-only', '--no-align', '-v', 'ON_ERROR_STOP=1'],
    connection,
    {
      input: countSql,
    },
  );
  return new Map(
    rows
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [table, n] = line.split('|');
        return [table, Number(n)];
      }),
  );
}

/** Compare restored counts with source counts taken before and after the dump. */
export function compareCounts(before, after, restored) {
  const problems = [];
  const changed = [];
  for (const [table, start] of before) {
    const end = after.get(table) ?? start;
    const got = restored.get(table);
    if (got === undefined) problems.push(`${table}: missing after restore`);
    else if (start === end && got !== start)
      problems.push(`${table}: source ${start}, restored ${got}`);
    else if (start !== end) {
      // The dump is one snapshot taken between the two counts.
      if (got < Math.min(start, end) || got > Math.max(start, end))
        problems.push(`${table}: restored ${got}, outside source ${start}..${end}`);
      else changed.push(table);
    }
  }
  for (const table of restored.keys())
    if (!before.has(table)) problems.push(`${table}: not in source`);
  return { problems, changed };
}

async function main() {
  const flag = process.argv.indexOf('--dump');
  const dumpArg = flag > 0 ? process.argv[flag + 1] : undefined;
  if (!dumpArg?.endsWith('.dump')) fail('Pass --dump <path ending in .dump> for the backup file.');
  const dump = resolve(dumpArg);
  if (existsSync(dump)) fail('The --dump file already exists; choose a new path.');
  const ignored = spawnSync('git', ['check-ignore', '--quiet', dump], { windowsHide: true });
  const insideRepo = dump.toLowerCase().startsWith(resolve('.').toLowerCase());
  if (insideRepo && ignored.status !== 0)
    fail('The backup holds personal data; write it outside the repository or to an ignored path.');

  const source = libpqEnv('RESTORE_SOURCE_URL', process.env.RESTORE_SOURCE_URL);
  const target = libpqEnv('RESTORE_TARGET_URL', process.env.RESTORE_TARGET_URL);
  if (sameDatabase(source, target)) fail('Source and target are the same database.');
  for (const key of ['DATABASE_URL', 'DIRECT_URL'])
    if (process.env[key] && /^postgres/.test(process.env[key])) {
      if (sameDatabase(target, libpqEnv(key, process.env[key])))
        fail(`RESTORE_TARGET_URL is the database in ${key}; restore into a separate database.`);
    }
  if (counts(target).size) fail('The target database already has tables; use an empty database.');

  console.log(`Tools: ${onPath ? 'PostgreSQL client on PATH' : `Docker image ${image}`}.`);
  const before = counts(source);
  if (!before.size) fail('The source database has no tables in the public schema.');

  const mount = dirname(dump);
  const file = `/backup/${basename(dump)}`;
  let started = Date.now();
  pg('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', file], source, { mount });
  const dumpMs = Date.now() - started;
  const after = counts(source);

  started = Date.now();
  pg(
    'pg_restore',
    [
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
      '--single-transaction',
      '--dbname',
      target.PGDATABASE,
      file,
    ],
    target,
    { mount },
  );
  const restoreMs = Date.now() - started;

  const { problems, changed } = compareCounts(before, after, counts(target));
  const rows = [...before.values()].reduce((sum, n) => sum + n, 0);
  console.log(
    `Backup: ${(statSync(dump).size / 1024).toFixed(1)} KiB in ${(dumpMs / 1000).toFixed(1)} s. Restore: ${(restoreMs / 1000).toFixed(1)} s.`,
  );
  console.log(`Tables: ${before.size}. Source rows: ${rows}.`);
  if (changed.length)
    console.log(`Changed during backup (restored count within range): ${changed.join(', ')}.`);
  if (problems.length) fail(`Row counts differ:\n- ${problems.join('\n- ')}`);
  console.log('PASS: restored database matches the source row counts for every table.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    if (!(error instanceof RehearsalError)) throw error;
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
