import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
// This harness intentionally only accepts a dedicated local PostgreSQL service.
if (!process.env.POSTGRES_TEST_URL)
  throw new Error('Set POSTGRES_TEST_URL to a disposable local PostgreSQL service.');
const url = new URL(process.env.POSTGRES_TEST_URL);
if (!['postgres:', 'postgresql:'].includes(url.protocol))
  throw new Error('Use a PostgreSQL test connection.');
if (!['localhost', '127.0.0.1'].includes(url.hostname))
  throw new Error('Use a disposable local PostgreSQL service.');
const schema = `coaching_rehearsal_${randomUUID().replaceAll('-', '')}`;
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: url.pathname.slice(1) || 'postgres',
};
function sql(statement, scoped = true) {
  const result = spawnSync(
    'psql',
    ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set', 'ON_ERROR_STOP=1'],
    {
      env: { ...env, ...(scoped ? { PGOPTIONS: `-csearch_path=${schema}` } : {}) },
      input: statement,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error('PostgreSQL rehearsal failed. Check the local service and psql installation.');
  return result.stdout.trim();
}
sql(`CREATE SCHEMA "${schema}";`, false);
try {
  const migrations = (await readdir('prisma/postgres/migrations', { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const migration of migrations) {
    if (migration === '20261024000000_coaching_measurements') {
      sql(`INSERT INTO "User" (id,name,email,"updatedAt",role) VALUES ('owner','Owner','owner@example.test',CURRENT_TIMESTAMP,'coach');
        INSERT INTO "Studio" (id,name,"ownerId") VALUES ('studio','Studio','owner');
        INSERT INTO "WorkoutSet" (id,"clientId","userId",exercise,"ruleVersion","setNumber",target,reps,"activeMs","trackedMs","rejectedReps",completed,"startedAt","endedAt") VALUES ('legacy','legacy','owner','curl','profile-v7',1,10,8,10000,8000,0,false,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);`);
    }
    sql(await readFile(`prisma/postgres/migrations/${migration}/migration.sql`, 'utf8'));
  }
  assert.equal(
    sql(`SELECT reps || ':' || (measurement IS NULL)::text FROM "WorkoutSet" WHERE id='legacy';`),
    '8:true',
  );
  sql(`UPDATE "WorkoutSet" SET measurement='{"schemaVersion":2,"armMode":"both","arms":{"left":{"reps":8},"right":{"reps":8}}}'::jsonb WHERE id='legacy';
    INSERT INTO "CustomExercise" (id,"studioId","createdById",name,equipment,instructions,"targetUnit") VALUES ('custom:test','studio','owner','Test','Band','Coach instructions','reps');
    INSERT INTO "WorkoutCorrection" (id,"setId","actorId",reps,"holdMs",reason) VALUES ('correction','legacy','owner',7,0,'Coach observation');`);
  assert.equal(sql(`SELECT measurement->>'armMode' FROM "WorkoutSet" WHERE id='legacy';`), 'both');
  assert.equal(sql(`SELECT reps FROM "WorkoutSet" WHERE id='legacy';`), '8');
  assert.equal(sql(`SELECT reps FROM "WorkoutCorrection" WHERE "setId"='legacy';`), '7');
  sql(`INSERT INTO "NutritionProfile" ("userId","shareWithCoach",protein,"updatedById","updatedAt") VALUES ('owner',false,100,'owner',CURRENT_TIMESTAMP);
    INSERT INTO "NutritionEntry" (id,"userId",date,meal,description,"waterMl") VALUES ('journal','owner','2026-10-24','Water','Fixture water',250);
    INSERT INTO "AuditEvent" (id,"actorId",action,"targetId","detailsJson") VALUES ('audit','owner','attendance.correction','visit','{"reason":"Fixture error"}'::jsonb);`);
  assert.equal(sql(`SELECT "waterMl" FROM "NutritionEntry" WHERE id='journal';`), '250');
  assert.equal(
    sql(`SELECT "shareWithCoach"::text FROM "NutritionProfile" WHERE "userId"='owner';`),
    'false',
  );
  assert.equal(
    sql(`SELECT "detailsJson"->>'reason' FROM "AuditEvent" WHERE id='audit';`),
    'Fixture error',
  );
  console.log(
    'PASS: PostgreSQL migrations, legacy retention, JSONB arm metadata, scoped exercises, and append-only corrections.',
  );
} finally {
  sql(`DROP SCHEMA "${schema}" CASCADE;`, false);
}
