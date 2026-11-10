---
name: ui-change
description: Make and visually verify a Geez Squad UI or layout change (workspace views, live room, practice, studio pages) using design tokens, existing primitives, owning CSS modules, and screenshots at phone, desktop and short-landscape sizes. Use for any visual, alignment, spacing or responsive change.
argument-hint: "<screen and what should look different>"
---

# UI change with visual proof

Target: $ARGUMENTS

1. **Locate the owner**: find the component and the CSS file that owns the geometry
   (`meeting-workspace.module.css`, `camera-practice.module.css`, `theme.css`, `globals.css`
   "Layout polish", `next-phase.css`). Edit there. Do not add a new global override.
2. **Baseline**: if `geez-dev` is not running, start it via `preview_start` (name `geez-dev`).
   Capture the affected route at 390x844, 1440x900 and 844x390 before editing. For
   authenticated screens, use `/demo` or the e2e support helpers' `example.test` accounts on
   the isolated server only.
3. **Edit** with tokens (`tokens.css`) and primitives (`src/components/primitives/`,
   `src/components/ui.tsx`). Keep the theme light only, controls at least 44px, safe areas,
   `contain` for full-body media, and visible focus. Never change the analyzer video/canvas
   element tree for a layout tweak.
4. **After**: capture the same three viewports, check that the console has no errors, and
   use `javascript_tool` to measure anything the spec gives numbers for (control height,
   camera share and so on). Reset the viewport to desktop.
5. **Tests**: update or add the e2e spec that pins the area (`coach-layout`,
   `meeting-gallery`, `trainee-mobile-layout`, `workspace`, `next-phase`) and run it, plus
   `a11y`, via the isolated runner.
6. Report the before and after screenshots, the measured values, and the tests run. Camera
   and live-room changes still need a real phone, so say so.
