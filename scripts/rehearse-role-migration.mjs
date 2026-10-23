import { readFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
const path = fileURLToPath(new URL(`../prisma/role-rehearsal-${randomUUID()}.db`, import.meta.url));
const url = `file:${path.replaceAll('\\', '/')}`;
const db = new PrismaClient({ datasources: { db: { url } } });
const migrations = [
  '20261006142643_init',
  '20261009000000_training_insights',
  '20261009140000_session_room_identity',
  '20261019000000_studio_operations',
  '20261019010000_studio_classes',
  '20261022000000_member_accounts',
  '20261023000000_studio_roles',
];
function sql(input) {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'db',
      'execute',
      '--stdin',
      '--schema=prisma/schema.prisma',
    ],
    { env: { ...process.env, DATABASE_URL: url }, input, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, 'Disposable migration rehearsal failed');
}
try {
  for (const migration of migrations.slice(0, 6))
    sql(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'));
  sql(`INSERT INTO "User" (id,name,email,"updatedAt",role) VALUES ('owner','Owner','owner@example.test',CURRENT_TIMESTAMP,'coach'),('trainee','Trainee','trainee@example.test',CURRENT_TIMESTAMP,'trainee');
    INSERT INTO "Account" (id,"accountId","providerId","userId",password,"updatedAt") VALUES ('account','owner','credential','owner','unchanged-password-hash',CURRENT_TIMESTAMP);
    INSERT INTO "Session" (id,token,"userId","expiresAt","updatedAt") VALUES ('session','unchanged-session','owner',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO "Studio" (id,name,"ownerId") VALUES ('studio','Studio','owner');
    INSERT INTO "Membership" (id,"studioId","userId") VALUES ('accepted','studio','trainee');
    INSERT INTO "StudioStaff" (id,"studioId",name,role) VALUES ('directory','studio','Directory coach','Head coach');
    INSERT INTO "ClassSession" (id,"studioId",title,"startsAt") VALUES ('class','studio','Legacy class',CURRENT_TIMESTAMP);`);
  sql(await readFile(`prisma/migrations/${migrations[6]}/migration.sql`, 'utf8'));
  assert.equal(
    (await db.account.findUnique({ where: { id: 'account' } })).password,
    'unchanged-password-hash',
  );
  assert.equal(
    (await db.session.findUnique({ where: { id: 'session' } })).token,
    'unchanged-session',
  );
  assert.equal((await db.user.findUnique({ where: { id: 'owner' } })).emailVerified, false);
  assert.equal((await db.user.findUnique({ where: { id: 'owner' } })).role, 'coach');
  assert.equal(await db.studioRoleGrant.count({ where: { role: 'admin' } }), 1);
  assert.equal(await db.studioRoleGrant.count({ where: { role: 'trainee' } }), 1);
  assert.equal(await db.studioRoleGrant.count({ where: { role: 'coach' } }), 0);
  assert.equal((await db.classSession.findUnique({ where: { id: 'class' } })).hostId, 'owner');
  assert.equal(await db.memberTerm.count(), 0);
  console.log(
    'PASS: additive SQLite role migration preserves credentials, sessions and verification flags, backfills owners and accepted trainees, records legacy hosts, and grants no directory privileges or invented terms.',
  );
} finally {
  await db.$disconnect();
  for (const suffix of ['', '-wal', '-shm', '-journal'])
    await unlink(path + suffix).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
}
