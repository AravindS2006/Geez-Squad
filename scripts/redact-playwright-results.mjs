// Prepare failed Playwright output for upload as a CI artifact. Traces record request headers
// (session cookies) and request bodies, which Playwright cannot switch off, so before upload:
// - delete storage-state, cookie and HAR files;
// - rewrite every trace.zip without its *.network entries (headers, cookies, request bodies);
// - redact cookie, authorization, session-token and password values in the remaining text.
// A trace this script cannot parse is deleted, never uploaded as-is.
// Usage: node scripts/redact-playwright-results.mjs <dir> [<dir> ...]
import { readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const PRIVATE_FILE =
  /(?:storage[-_]?state|auth[-_]?state|session[-_]?state|cookies?)(?:\.[\w-]+)?\.(?:json|txt)$|\.har$/i;
const TEXT_ENTRY = /\.(?:trace|stacks|json|jsonl|md|txt|html)$/i;

export function redactText(text) {
  return (
    text
      // Header objects ({"name":"Cookie","value":"..."}) and header maps ("cookie":"...").
      .replace(
        /("name"\s*:\s*"(?:cookie|set-cookie|authorization|x-csrf-token)"\s*,\s*"value"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
        '$1"[redacted]"',
      )
      .replace(
        /("(?:cookie|set-cookie|authorization|x-csrf-token)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
        '$1"[redacted]"',
      )
      // Cookie objects from storageState()/addCookies(): {"name":"...","value":"..."}.
      .replace(
        /("name"\s*:\s*"[^"]*(?:session|token|auth|csrf)[^"]*"\s*,\s*"value"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
        '$1"[redacted]"',
      )
      // Raw cookie pairs and bearer tokens anywhere in text.
      .replace(/(better-auth[\w.-]*=)[^;\s"'\\]+/gi, '$1[redacted]')
      .replace(/(bearer\s+)[\w.~+/-]+=*/gi, '$1[redacted]')
      // Field values in DOM snapshots and in action log lines (fill("...")).
      .replace(/("__playwright_value_"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"[redacted]"')
      .replace(/((?:fill|type|pressSequentially)\(\\")(?:[^"\\]|\\[^"])*(\\"\))/g, '$1[redacted]$2')
      // Passwords typed into forms or sent as JSON.
      .replace(
        /("(?:password|newPassword|currentPassword)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
        '$1"[redacted]"',
      )
      .replace(
        /(\\"(?:password|newPassword|currentPassword)\\"\s*:\s*)\\"(?:[^"\\]|\\[^"])*\\"/gi,
        '$1\\"[redacted]\\"',
      )
  );
}

export function readEntries(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--)
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not a zip');
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new Error('zip64 unsupported');
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad central directory');
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (flags & 1) throw new Error('encrypted entry');
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('bad local header');
    const start =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`compression method ${method}`);
    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const TYPED_ACTIONS = new Set(['fill', 'type', 'pressSequentially', 'setInputFiles']);
/** Trace event lines (JSONL): drop the text typed into fields; keep the action and locator. */
export function redactTraceEvents(text) {
  return text
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      try {
        const event = JSON.parse(line);
        if (TYPED_ACTIONS.has(event.method) && event.params && 'value' in event.params) {
          event.params.value = '[redacted]';
          return JSON.stringify(event);
        }
      } catch {
        // Not JSON: fall through to the text redaction.
      }
      return line;
    })
    .join('\n');
}

/** Returns the redacted zip, or throws when the archive cannot be parsed safely. */
export function redactTraceZip(zip) {
  const entries = readEntries(zip);
  const text = (pattern) =>
    entries
      .filter(({ name }) => pattern.test(name))
      .map(({ data }) => data.toString('utf8'))
      .join('\n');
  // Request and response bodies are stored as resources named by their SHA-1 and referenced
  // only from the network log. Keep a resource only if the action/snapshot log uses it.
  const events = text(/\.trace$/i);
  const networkOnly = new Set(
    [...text(/\.network$/i).matchAll(/[0-9a-f]{40}/g)]
      .map(([sha]) => sha)
      .filter((sha) => !events.includes(sha)),
  );
  return writeZip(
    entries
      .filter(
        ({ name }) =>
          !/\.network$/i.test(name) &&
          !PRIVATE_FILE.test(name) &&
          !(
            name.startsWith('resources/') &&
            networkOnly.has(name.slice('resources/'.length, 'resources/'.length + 40))
          ),
      )
      .map(({ name, data }) => {
        if (!TEXT_ENTRY.test(name)) return { name, data };
        let content = data.toString('utf8');
        if (/\.trace$/i.test(name)) content = redactTraceEvents(content);
        return { name, data: Buffer.from(redactText(content), 'utf8') };
      }),
  );
}

async function walk(dir, summary) {
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await walk(path, summary);
    else if (PRIVATE_FILE.test(item.name)) {
      await rm(path, { force: true });
      summary.deleted++;
    } else if (item.name.endsWith('.zip')) {
      try {
        await writeFile(path, redactTraceZip(await readFile(path)));
        summary.traces++;
      } catch (error) {
        await rm(path, { force: true });
        summary.deleted++;
        console.warn(`Removed ${item.name}: ${error.message}.`);
      }
    } else if (TEXT_ENTRY.test(item.name) && (await stat(path)).size < 20e6) {
      await writeFile(path, redactText(await readFile(path, 'utf8')));
      summary.text++;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dirs = process.argv.slice(2);
  if (!dirs.length) throw new Error('Pass the Playwright output directories to redact.');
  const summary = { traces: 0, text: 0, deleted: 0 };
  for (const dir of dirs) await walk(dir, summary);
  console.log(
    `Redacted ${summary.traces} traces and ${summary.text} text files; removed ${summary.deleted} private or unreadable files.`,
  );
}
