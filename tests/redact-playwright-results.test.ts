import { describe, expect, it } from 'vitest';
import * as redact from '../scripts/redact-playwright-results.mjs';

type Entry = { name: string; data: Buffer };
const bodySha = 'a'.repeat(40);
const styleSha = 'b'.repeat(40);
const session = 'session-value-for-this-test-only';
const typed = 'typed-value-for-this-test-only';
const body = 'request-body-for-this-test-only';

function traceZip() {
  const events = [
    { type: 'before', method: 'fill', params: { selector: '#password', value: typed } },
    { type: 'log', message: `  fill("${typed}")` },
    {
      type: 'frame-snapshot',
      snapshot: {
        html: ['INPUT', { __playwright_value_: typed }],
        resourceOverrides: [{ url: '/app.css', sha1: `${styleSha}.css` }],
      },
    },
    {
      type: 'before',
      method: 'addCookies',
      params: { cookies: [{ name: 'better-auth.session_token', value: session }] },
    },
  ];
  const network = {
    type: 'resource-snapshot',
    snapshot: {
      request: {
        headers: [{ name: 'Cookie', value: `better-auth.session_token=${session}` }],
        postData: { _sha1: `${bodySha}.txt` },
      },
    },
  };
  return redact.writeZip([
    { name: 'trace.trace', data: Buffer.from(events.map((e) => JSON.stringify(e)).join('\n')) },
    { name: 'trace.network', data: Buffer.from(JSON.stringify(network)) },
    { name: `resources/${bodySha}.txt`, data: Buffer.from(`{"password":"${body}"}`) },
    { name: `resources/${styleSha}.css`, data: Buffer.from('body{color:red}') },
    { name: 'storage-state.json', data: Buffer.from(`{"cookies":[{"value":"${session}"}]}`) },
  ]);
}

describe('Playwright trace redaction before CI upload', () => {
  it('drops the network log, request bodies and storage state, and keeps the trace usable', () => {
    const entries: Entry[] = redact.readEntries(redact.redactTraceZip(traceZip()));
    expect(entries.map((e) => e.name).sort()).toEqual([`resources/${styleSha}.css`, 'trace.trace']);
    const all = entries.map((e) => e.data.toString('utf8')).join('\n');
    for (const secret of [session, typed, body]) expect(all).not.toContain(secret);
    const events = entries
      .find((e) => e.name === 'trace.trace')!
      .data.toString('utf8')
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events[0]).toMatchObject({ method: 'fill', params: { selector: '#password' } });
    expect(events[0].params.value).toBe('[redacted]');
  });

  it('redacts cookie headers, bearer tokens and JSON passwords in plain text', () => {
    const out = redact.redactText(
      `{"cookie":"a=b","Authorization":"Bearer abc.def","password":"pw"} better-auth.session_token=xyz;`,
    );
    expect(out).toBe(
      '{"cookie":"[redacted]","Authorization":"[redacted]","password":"[redacted]"} better-auth.session_token=[redacted];',
    );
  });

  it('refuses archives it cannot parse instead of passing them through', () => {
    expect(() => redact.redactTraceZip(Buffer.from('not a zip archive'))).toThrow();
  });
});
