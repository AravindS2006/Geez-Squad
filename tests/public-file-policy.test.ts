import { describe, expect, it } from 'vitest';
import { privatePathReason, unsafeTemplateKeys } from '../scripts/public-file-policy.mjs';

describe('public repository file boundaries', () => {
  it.each([
    '.env',
    '.env.local',
    '.env.production',
    '.envrc',
    '.netrc',
    '.aws/credentials',
    'nested/.env.example',
    '.vercel/project.json',
    'test-results/browser-runs/trace.zip',
    'prisma/dev.db',
    'prisma/dev.db-wal',
    'backup.sql',
    'studio-backup.sql',
    'keys/private.pem',
    'session/storageState.json',
    'cookies.json',
    'capture.har',
    'private-session.webm',
    'docs/screenshots/member.png',
  ])('rejects private or generated file %s', (file) => {
    expect(privatePathReason(file)).toBeTruthy();
  });
  it.each([
    '.env.example',
    '.env.production.example',
    '.github/workflows/ci.yml',
    'src/lib/security.ts',
    'tests/session-timing.test.ts',
    'prisma/migrations/20261006142643_init/migration.sql',
    'public/pwa/icon-512.png',
    'docs/VERIFICATION.md',
  ])('allows intended source file %s', (file) => {
    expect(privatePathReason(file)).toBeNull();
  });
  it('allows empty and placeholder credentials in templates', () => {
    expect(
      unsafeTemplateKeys(
        'LIVEKIT_API_SECRET=""\nBETTER_AUTH_SECRET="replace-with-random-value"\nDATABASE_URL="file:./dev.db"',
      ),
    ).toEqual([]);
  });
  it('reports only key names for filled credential fields', () => {
    expect(
      unsafeTemplateKeys(
        'SMTP_PASSWORD="fixture value"\nDIRECT_URL="fixture connection"\nBETTER_AUTH_URL=https://example.test',
      ),
    ).toEqual(['SMTP_PASSWORD', 'DIRECT_URL']);
  });
});
