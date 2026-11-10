---
paths:
  - "src/app/**/*.css"
  - "src/app/**/page.tsx"
  - "src/app/**/layout.tsx"
  - "src/components/**/*.tsx"
  - "src/components/**/*.css"
---

# UI rules

- **Light only.** No dark mode, no theme toggle, no `prefers-color-scheme` branches.
- **Tokens** from `src/app/tokens.css`: `--fs-2xs..--fs-lg`, `--surface-*`, `--text-1..3`
  (tertiary text no lighter than `--text-3`), `--border-*`, `--brand*`, `--accent`
  (volt lime, use sparingly), `--success/--warning/--danger`, `--radius-*`, `--shadow-*`,
  `--ease`, `--dur*`, and `--focus-ring`. No new hex values in components.
- **Primitives**: `src/components/primitives/` (`ToastProvider`/`useToast`, `BarChart`) and
  `src/components/ui.tsx` (`Avatar`, `EmptyState`, `Modal`, `SectionTitle`, `TextAction`).
  Extend these before creating a new look-alike.
- **Ownership**: room geometry lives in `meeting-workspace.module.css`, practice geometry in
  `camera-practice.module.css`, and shared component look in `src/app/theme.css` (loaded
  last). Edit the owning file and don't add another global override. Camera and meeting rules
  keep their pixel sizes because e2e tests pin the geometry.
- **Layout**: full-body media uses `object-fit: contain`, primary controls are at least
  44px, honor `env(safe-area-inset-*)`, keyboard focus stays visible, and short landscape
  must work (`max-height: 550px`). Phone breakpoint: `max-width: 760px`.
- No `loading.tsx` above pages that redirect, because streaming turns the 307 into a 200.
- Client components need `'use client'`. Check the installed Next.js docs before using
  routing or data APIs.
- Evidence: screenshots at 390x844, desktop and short landscape, the relevant e2e spec
  (`coach-layout`, `meeting-gallery`, `trainee-mobile-layout`, `workspace`), `a11y`, and
  no page errors. Use the `ui-change` skill.
