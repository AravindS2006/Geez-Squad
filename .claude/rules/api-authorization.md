---
paths:
  - "src/app/api/**"
  - "src/lib/*-access.ts"
  - "src/lib/security.ts"
  - "src/lib/video-grants.ts"
  - "src/lib/studio-team.ts"
  - "src/lib/session-management.ts"
  - "src/lib/workspace.ts"
---

# API and authorization rules

Every handler follows this order. Read `src/app/api/nutrition/route.ts` for the pattern.

1. `const actor = await requireUser()` (`src/lib/security.ts`). Never trust a `userId` or
   `studioId` from the client as proof of anything.
2. Parse input with a zod schema (`validation.ts` or the feature module) via
   `schema.parse(await readJson(request))`. Bound string lengths and dates.
3. `await rateLimit(actor.id, '<action>', n)` on writes.
4. Authorize **inside** the same `db.$transaction` as the read or write, with the existing
   helpers: `requireStudio`, `requireTraineeAccess`, `classPermissions` (`studio-access.ts`),
   `requireParticipation` (`member-access.ts`), `requireNutritionAccess`, `exercise-access.ts`,
   and `video-grants.ts`. Recheck the current coach assignment and studio scope on every read
   and write.
5. Scope every query by the authorized ids (`where: { id, userId }`). Return 404 rather than
   403 for rows that belong to someone else.
6. Write an `auditEvent` for privileged mutations, as nearby handlers do.
7. `catch (e) { return safeError(e) }`. Throw `ApiError(status, userMessage)` for expected
   failures. Never leak stack traces, SQL or other users' data.
8. Personal data responses use `Cache-Control: private, no-store`.

Invariants: job titles never grant permissions. Public signup never grants admin or coach.
Nutrition is private by default. Private cues reach only the targeted trainee. Membership
expiry, role change, reassignment and session revocation remove room access, and HTTP
checks remain even when LiveKit also notifies. Hiding a button is never the fix.

Mutations from the workspace go through `src/app/api/command/route.ts` (central
dispatcher) unless the feature already has its own guarded route.
Evidence: the unit tests for the helper (`tests/*-access.test.ts`, `video-grants.test.ts`)
and the isolated runner checks `api`, `roles`, `studio`, `coaching`, `next` and `account`,
including cross-studio and reassignment cases.
