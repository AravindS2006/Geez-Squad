---
name: api-route
description: Add or change a Geez Squad API route handler or command-dispatcher action with the project's authentication, zod validation, rate limit, in-transaction authorization, audit and safeError pattern. Use whenever creating or modifying files under src/app/api or adding a command action.
---

# API route or command action

## Decide where it goes

- A workspace mutation that fits an existing feature: add a variant to `commandSchema`
  (`src/lib/validation.ts`, a discriminated union on `action`) and a branch in
  `src/app/api/command/route.ts`.
- A feature with its own resource (as with nutrition, workout-sets or studio-team): use that
  route or a new `src/app/api/<resource>/route.ts`.
- Check the installed docs first for route handler signatures, dynamic params and caching:
  `node_modules/next/dist/docs/01-app/` (see the `next-docs` skill).

## Pattern (mirror `src/app/api/nutrition/route.ts`)

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loggedRoute } from '@/lib/request-log';
import { ApiError, requireUser, readJson, rateLimit, safeError } from '@/lib/security';

async function post(request: Request) {
  try {
    const actor = await requireUser();                       // 1. authenticate
    const input = thingSchema.parse(await readJson(request)); // 2. validate (zod, bounded)
    await rateLimit(actor.id, 'thing', 30);                   // 3. throttle writes
    const result = await db.$transaction(async (tx) => {
      await requireStudio(actor.id, input.studioId, tx);      // 4. authorize in-transaction
      const row = await tx.thing.findFirst({ where: { id: input.id, studioId: input.studioId } });
      if (!row) throw new ApiError(404, 'Not found.');        // 5. scope; 404 for foreign rows
      const updated = await tx.thing.update({ where: { id: row.id }, data: { ... } });
      await tx.auditEvent.create({ data: { ... } });          // 6. audit privileged writes
      return updated;
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return safeError(e);                                      // 7. never leak internals
  }
}
```

Export through the request logger exactly as existing routes do:

```ts
export const POST = loggedRoute('/api/<resource>', post);
```

## Rules

- Find the right helper in `studio-access.ts`, `member-access.ts`, `nutrition-access.ts`,
  `exercise-access.ts` or `video-grants.ts`. Add a new helper there (pure and unit tested)
  only when none fits.
- Saves must be idempotent: client-generated ids plus upsert, so a retry never duplicates.
- Changes that affect room access must also call the existing revocation and reconcile
  paths (`member-access.ts`).
- Tests: a unit test for any new helper or schema, and a case in the matching runner script
  (`scripts/test-api.mjs`, `test-studio-roles.mjs`, ...) covering an unauthorized actor, a
  cross-studio actor and the happy path.
- Then run the `authz-auditor` subagent on the diff.
