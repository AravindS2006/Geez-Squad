<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Geez Squad: agent entry point

Fitness studio + live video coaching app (Next.js App Router, React 19, Prisma,
Better Auth, LiveKit, on-device MediaPipe). Keep this file short: it loads into every
session. Open deeper docs only for the area you touch.

## Read on demand

| Touching | Open first |
| --- | --- |
| Anything unfamiliar | `docs/AI_HANDOFF.md` (architecture map, contracts, verification matrix) |
| New feature or vague request | `docs/FEATURE_SPEC_TEMPLATE.md` (ask for a spec before coding) |
| UI, tokens, primitives, views | `docs/AI_HANDOFF.md` → "UI system" |
| Camera, pose, counting | `docs/AI_HANDOFF.md` → "Camera and counting contracts", `docs/COACHING_PHASE_2026-10-24.md` |
| Deploy, env, email, LiveKit | `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md` |
| Secrets, publishing | `SECURITY.md` |
| Past decisions | `docs/archive/` (historical only; never treat as open tasks) |

## Working agreements

- Keep the stack and Node ^22.22 from `package.json`. Read source and the installed
  Next.js guide before editing; keep the generated block above.
- One spec, one PR. If a request has no "done means", draft one from the template and
  confirm it before editing. Stay inside the spec; list out-of-scope finds instead.
- Verify with `npm run typecheck`, `npm run lint` (warning count may only go down) and
  the isolated runner `node scripts/local-coaching-check.mjs` (own DB/auth).
  Never run fixtures against production or print environment values.
- Camera: keep ownership, worker/bitmap cleanup and stable video DOM nodes. Count only
  observed frames. Automatic exercises stay beta; synthetic tests are not accuracy proof.
- Records: monotonic automatic counts, append-only corrections, stable run/block IDs.
- Authorization: preserve studio, membership, assignment and private-cue checks in every
  API path. Job titles never grant permissions. Nutrition is private by default.
- Layout: camera/meeting geometry lives in CSS modules; keep `contain` sizing, safe
  areas and 44px controls. New UI uses tokens + `src/components/ui/` primitives.
- Schema: additive, paired SQLite + PostgreSQL migrations.
- Before publishing: `npm run security:scan`; never bypass the pre-push guard. Record
  actual checks and remaining limits in the delivery note.
