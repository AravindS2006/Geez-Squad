# Area blocks for prompt-architect

Copy only the blocks for the areas the request touches into `<architecture_guidelines>`
and `<constraints>`. Every line is phrased as an action to take. Sources:
`docs/AI_HANDOFF.md` and `.claude/rules/`.

## Always

```xml
<constraint>Change only the files in scope; list other findings under scope/out.</constraint>
<constraint>Run checks with the isolated runner (scripts/local-coaching-check.mjs) against its own SQLite DB.</constraint>
<constraint>Keep the lint warning count at or below the package.json cap and at or below its value before the change.</constraint>
<constraint>Report each check as passed, failed (with first error) or not run (with reason).</constraint>
```

## API and authorization

```xml
<guideline area="api">Handlers follow src/app/api/nutrition/route.ts: requireUser, zod parse via readJson, rateLimit on writes, db.$transaction with the access helper inside, queries scoped by authorized ids, auditEvent for privileged writes, safeError, export via loggedRoute.</guideline>
<guideline area="api">Workspace mutations go through commandSchema (src/lib/validation.ts) and src/app/api/command/route.ts.</guideline>
<constraint>Authorize every read and write with studio-access, member-access, nutrition-access, exercise-access or video-grants helpers inside the transaction.</constraint>
<constraint>Return 404 for rows outside the actor's scope.</constraint>
<constraint>Grant permissions from authenticated roles and assignments only; treat job titles as display text.</constraint>
<constraint>Keep nutrition private unless sharing is on and the coach is currently assigned in the same studio.</constraint>
```

## Camera, pose and counting

```xml
<guideline area="camera">Pipeline: camera, bitmap, worker inference, continuity/joint validation, geometry, per-limb states, rep events, feedback, summaries.</guideline>
<constraint>Stop owned tracks, terminate owned workers and close every ImageBitmap on every exit path.</constraint>
<constraint>Leave borrowed LiveKit tracks running when layout or tracking mode changes.</constraint>
<constraint>Keep the analyzer video/canvas DOM nodes and the active stream stable across layout changes.</constraint>
<constraint>Derive counts only from observed frames; keep automatic counts monotonic and corrections append-only.</constraint>
<constraint>Keep automatic support limited to the 12 beta profiles; offer manual or timed for the rest.</constraint>
<constraint>Describe synthetic test results as pipeline evidence, and list real-device checks as still required.</constraint>
```

## Schema and records

```xml
<guideline area="schema">prisma/schema.prisma is the source of truth; prisma/postgres/schema.prisma is generated.</guideline>
<constraint>Add new tables, nullable/defaulted columns or indexes in paired directories prisma/migrations/NAME and prisma/postgres/migrations/NAME.</constraint>
<constraint>Keep committed migrations unchanged; add a new migration for every change.</constraint>
<constraint>Use stable run and block IDs and idempotent upserts so retries never duplicate sets.</constraint>
<constraint>Verify SQLite with the runner build; cite the CI postgres-coaching job for PostgreSQL.</constraint>
```

## UI and layout

```xml
<guideline area="ui">Light-only "Performance studio" look: tokens in src/app/tokens.css, shared look in src/app/theme.css, primitives in src/components/primitives/ and src/components/ui.tsx.</guideline>
<guideline area="ui">Room geometry lives in meeting-workspace.module.css; practice geometry in camera-practice.module.css.</guideline>
<constraint>Use tokens for color, type, radius, shadow and motion.</constraint>
<constraint>Make primary controls at least 44px, honor env(safe-area-inset-*), keep focus visible, and use object-fit: contain for full-body media.</constraint>
<constraint>Prove layout with screenshots at 390x844, 1440x900 and 844x390 plus the e2e spec that pins the area.</constraint>
```

## Live room

```xml
<guideline area="live">HTTP snapshots are the reconciliation source; LiveKit notifications are hints checked by sequence/revision.</guideline>
<constraint>Persist coach commands and private cues before notifying; deliver private cues only to the target trainee.</constraint>
<constraint>Subscribe to the visible page plus the focused trainee; request high quality only for focus; keep alphabetical tile order.</constraint>
<constraint>Remove room access when membership, role, assignment or session is revoked, through the HTTP checks as well as LiveKit.</constraint>
```

## Deploy and secrets

```xml
<constraint>Check configuration by key presence and status only.</constraint>
<constraint>Run migrations and deploys only as a user-authorized release step per docs/DEPLOYMENT.md.</constraint>
<constraint>Run npm run security:scan before publishing and let the pre-push guard run.</constraint>
```
