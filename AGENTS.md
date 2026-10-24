<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Geez Squad: agent entry point

Read [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) before changing unfamiliar areas. It is
the current architecture and workflow map; dated audits describe earlier releases.
`CLAUDE.md` points here so agents share the same context. Follow the user's current
scope and authorization instead of treating historical plans as unfinished tasks.

## Working agreements

- Keep the existing Next.js, React, Better Auth, Prisma, MediaPipe and LiveKit stack.
  Use the Node 22.22+ runtime declared by `package.json`.
- Read source and relevant installed Next.js guides before editing. Preserve the
  generated block above; Next.js updates it during development.
- Use a dedicated local database for verification. The `local-coaching-check.mjs`
  runner isolates database, auth, provider settings and temporary files. Never run
  fixture scripts against production, or print/publish environment values.
- Keep camera ownership, worker/bitmap cleanup and stable video DOM nodes intact.
  Count only observed frames; visual interpolation is never counting evidence.
- Keep automatic counts monotonic, corrections append-only, and workout run/block
  identities stable. Exercise selection and curl arm mode are explicit contracts.
- Automatic exercises remain beta until physical pilot gates pass. Do not describe
  synthetic landmark tests or fake-camera tests as physical accuracy validation.
- Preserve studio, membership, assignment and private-cue authorization in every
  API path. Staff job titles alone never grant application permissions.
- Keep nutrition private by default and retain affirmative sharing/history consent.
- Use scoped CSS modules for camera/meeting geometry. Do not add competing global
  layout overrides. Preserve full-body `contain` sizing and safe-area controls.
- Pair additive SQLite and PostgreSQL migrations. Preserve old records and queues;
  never fabricate historical arm counts, load semantics, or validation results.
- Run checks appropriate to the changed boundary; see the handoff verification
  matrix. Review desktop, portrait and landscape for camera UI changes.
- Run `npm run security:scan` before publication. Never bypass the installed
  pre-push guard. Keep traces, cookies, keys, local databases and `.vercel/` ignored.
- Record actual verification, remaining limitations and canonical documentation
  changes in the delivery note. No secrets or private recordings belong in docs.
