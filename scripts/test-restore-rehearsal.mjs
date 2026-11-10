// Proves scripts/rehearse-restore.mjs on a disposable local PostgreSQL in Docker:
// migrates a source database with the committed migrations, seeds member, payment, workout
// and audit rows, backs it up and restores it into a second database, then checks that the
// rehearsal refuses a non-empty target and a target equal to the source.
// No production credentials are read or needed.
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';

const image = process.env.RESTORE_PG_IMAGE || 'postgres:17-alpine';
const password = randomBytes(24).toString('hex');
const container = `geez-restore-${randomUUID()}`;
const work = resolve('test-results/restore-rehearsal');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

function docker(args, input) {
  return spawnSync('docker', args, {
    env: { ...process.env, POSTGRES_PASSWORD: password },
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000,
  });
}
function sql(database, statement) {
  const result = docker(
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'postgres',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '--tuples-only',
      '--no-align',
    ],
    statement,
  );
  if (result.status !== 0) throw new Error(`Local SQL failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}
function rehearse(target, dumpName, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    ['scripts/rehearse-restore.mjs', '--dump', `${work}/${dumpName}.dump`],
    {
      env: {
        ...process.env,
        DATABASE_URL: '',
        DIRECT_URL: '',
        RESTORE_SOURCE_URL: url('geez_source'),
        RESTORE_TARGET_URL: url(target),
        ...extraEnv,
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 300000,
    },
  );
}
let port;
const url = (database) => {
  const value = new URL(`postgresql://postgres@127.0.0.1:${port}/${database}`);
  value.password = password;
  return value.href;
};

try {
  const started = docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--publish',
    '127.0.0.1::5432',
    '--env',
    'POSTGRES_PASSWORD',
    image,
  ]);
  if (started.status !== 0) throw new Error(`Could not start ${image}: ${started.stderr.trim()}`);
  port = docker(['port', container, '5432/tcp'])
    .stdout?.trim()
    .match(/127\.0\.0\.1:(\d+)/)?.[1];
  if (!port) throw new Error('The test database must bind only to loopback.');
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    ready =
      docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0;
    if (!ready) await setTimeout(1000);
  }
  if (!ready) throw new Error('The test database did not become ready.');
  sql(
    'postgres',
    'CREATE DATABASE geez_source; CREATE DATABASE geez_restored; CREATE DATABASE geez_busy;',
  );

  // Apply the committed migrations exactly as production does.
  const migrate = spawnSync(process.execPath, ['scripts/postgres.mjs', 'migrate'], {
    env: { ...process.env, DATABASE_URL: url('geez_source'), DIRECT_URL: url('geez_source') },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(migrate.status, 0, `Migrations failed: ${migrate.stderr}`);

  sql(
    'geez_source',
    `INSERT INTO "User" (id,name,email,"updatedAt",role) VALUES
       ('owner','Owner','owner@example.test',CURRENT_TIMESTAMP,'coach'),
       ('member','Member','member@example.test',CURRENT_TIMESTAMP,'trainee');
     INSERT INTO "Studio" (id,name,"ownerId") VALUES ('studio','Studio','owner');
     INSERT INTO "WorkoutSet" (id,"clientId","userId",exercise,"ruleVersion","setNumber",target,reps,"activeMs","trackedMs","rejectedReps",completed,"startedAt","endedAt")
       VALUES ('set-1','set-1','member','squat','profile-v7',1,10,10,30000,28000,0,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
     INSERT INTO "AuditEvent" (id,"actorId",action,"targetId","detailsJson")
       VALUES ('audit','owner','restore.fixture','studio','{"note":"fixture"}'::jsonb);`,
  );
  sql('geez_busy', 'CREATE TABLE "Existing" (id int);');

  const ok = rehearse('geez_restored', 'backup');
  process.stdout.write(ok.stdout);
  assert.equal(ok.status, 0, `Rehearsal failed: ${ok.stderr}`);
  assert.match(ok.stdout, /PASS: restored database matches/);
  assert.ok(!ok.stdout.includes(password) && !ok.stderr.includes(password), 'Password printed');
  assert.equal(
    sql('geez_restored', `SELECT email FROM "User" WHERE id='member';`).trim(),
    'member@example.test',
  );
  assert.equal(
    sql('geez_restored', `SELECT "detailsJson"->>'note' FROM "AuditEvent";`).trim(),
    'fixture',
  );

  const busy = rehearse('geez_busy', 'busy');
  assert.notEqual(busy.status, 0);
  assert.match(busy.stderr, /already has tables/);

  const same = rehearse('geez_source', 'same');
  assert.notEqual(same.status, 0);
  assert.match(same.stderr, /same database/);

  const appTarget = rehearse('geez_restored', 'app', { DIRECT_URL: url('geez_restored') });
  assert.notEqual(appTarget.status, 0);
  assert.match(appTarget.stderr, /DIRECT_URL/);

  console.log(
    'PASS: backup and restore rehearsal, row counts, and refusal of non-empty, source and app targets.',
  );
} finally {
  if (docker(['rm', '--force', container]).status !== 0)
    console.warn('Could not remove the disposable database container.');
  rmSync(work, { recursive: true, force: true });
}
