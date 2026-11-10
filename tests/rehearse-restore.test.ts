import { describe, expect, it } from 'vitest';
import { compareCounts, libpqEnv } from '../scripts/rehearse-restore.mjs';

const map = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe('restore rehearsal row-count comparison', () => {
  it('passes when every table matches the source', () => {
    const source = map({ User: 3, StudioPayment: 2 });
    expect(compareCounts(source, source, map({ User: 3, StudioPayment: 2 }))).toEqual({
      problems: [],
      changed: [],
    });
  });
  it('reports lost rows and missing or extra tables by name', () => {
    const source = map({ User: 3, WorkoutSet: 5 });
    const { problems } = compareCounts(source, source, map({ User: 2, Stray: 1 }));
    expect(problems).toEqual([
      'User: source 3, restored 2',
      'WorkoutSet: missing after restore',
      'Stray: not in source',
    ]);
  });
  it('accepts a table written during the backup only within the before..after range', () => {
    const before = map({ AuditEvent: 10 });
    const after = map({ AuditEvent: 12 });
    expect(compareCounts(before, after, map({ AuditEvent: 11 }))).toEqual({
      problems: [],
      changed: ['AuditEvent'],
    });
    expect(compareCounts(before, after, map({ AuditEvent: 9 })).problems).toHaveLength(1);
  });
});

// Credentials are set through the URL API at runtime, on reserved `.test` hosts, so the
// source holds no connection string with a password that secret scanners would flag.
function connectionUrl(host: string, query = '') {
  const url = new URL(`postgresql://${host}/sampledb${query}`);
  url.username = 'sample-user';
  url.password = ['sample', 'pa@ss'].join('-');
  return url.href;
}

describe('restore rehearsal connection parsing', () => {
  it('maps a direct URL with TLS settings to libpq variables', () => {
    expect(
      libpqEnv(
        'X',
        connectionUrl('ep-sample.db.example.test', '?sslmode=require&channel_binding=require'),
      ),
    ).toEqual({
      PGHOST: 'ep-sample.db.example.test',
      PGPORT: '5432',
      PGUSER: 'sample-user',
      PGPASSWORD: 'sample-pa@ss',
      PGDATABASE: 'sampledb',
      PGSSLMODE: 'require',
      PGCHANNELBINDING: 'require',
    });
  });
  it('rejects pooled endpoints and non-PostgreSQL URLs without echoing them', () => {
    const pooled = connectionUrl('ep-sample-pooler.db.example.test');
    expect(() => libpqEnv('X', pooled)).toThrow('pooled endpoint');
    expect(() => libpqEnv('X', 'file:./dev.db')).toThrow('PostgreSQL connection URL');
    expect(() => libpqEnv('X', pooled)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('sample-pa') }),
    );
  });
});
