---
name: live-room-ui
description: Build or change the Geez Squad live room (video conferencing) layout — room shell, side panel (docked, floating, sheet), control dock, notices and cue overlay, floating video tiles, drag and resize — so it works on desktop and phones without breaking camera, LiveKit or accessibility contracts. Use for any edit to the meeting room structure, studio.tsx room markup, coach-monitor.tsx, room-panel.tsx, use-corner-drag.ts, room-layout.ts or meeting-workspace.module.css.
argument-hint: "<what in the live room should change>"
---

# Live room UI

Target: $ARGUMENTS

Use this with `ui-change` (screenshots, tokens) and before `/verify`. It encodes the
room's layout model, so a change lands in the right region instead of adding another row.

## 1. Room regions (each thing has exactly one home)

| Region | Owner | Holds | Never holds |
| --- | --- | --- | --- |
| Header | `studio.tsx` `.meeting-header` | Back, title, status chips, timer, current movement button | Forms, notices |
| Stage | `.meeting-stage` inside the shell main column | Coach gallery or trainee camera + coach video | Secondary tools |
| Notices | shell main column, in flow above the stage | Error, reconnect, audio, sync notices (they never cover the camera top bar or coach tile) | Permanent content |
| Cue banner | `.meeting-human-cue`, fixed over the header's right side | The trainee's latest coach cue (hides after 20 s, kept in Chat) | Anything else |
| Side panel | `room-panel.tsx` | Chat, Coach tools, Workout, Classmates, Options (tabs) | Join consent, End session (these stay modal) |
| Dock | `.meeting-dock` | Devices · class actions · panel toggles and Leave/End | Status text |
| Floating tiles | `use-corner-drag.ts` | Trainee's floating coach video, coach "My preview" | Analyzer camera |

Rule: a new element joins an existing region. If it needs a row of its own, it belongs in
the panel (a tab) or, if it is a transient failure state, the notices row.

## 2. Panel presentation (pure logic in `src/lib/room-layout.ts`)

`panelPresentation(viewport, preference)` decides, in this order:

1. Width ≤ 760px → `sheet` (bottom sheet, full width, ≤ 72dvh, safe-area padding).
2. Height ≤ 550px or width < 1024px → `side-sheet` (overlay from the right, full height).
3. Otherwise the saved preference → `docked` (grid column, stage shrinks) or `floating`.

- Docked width: drag the separator or use the arrow keys on it (16px, Shift 64px, Home/End).
  It is clamped to 300–560px and to at most 45% of the room.
- Floating: drag by the header or use the arrow keys on "Move panel". Resize with the corner
  "Resize panel" button (pointer or arrow keys). The rect is always clamped inside the room.
- Preference key `geez-squad:room-panel:v1`, read through `parsePanelPreference`. A bad
  value falls back to the defaults and never throws.
- Close, Escape and toggling the active tab close the panel, and focus returns to the
  button that opened it.

## 3. Non-negotiable invariants

- **Stable DOM**: the stage subtree (analyzer `<video>`/`<canvas>`, `#coach-video-feed`,
  gallery tiles) keeps its parent chain in every panel state. The panel renders as a
  sibling after the stage. Dock, undock, resize and drag change classes, CSS variables and
  `transform` only. Prove it with the `data-layout-fixture` attribute trick from
  `coach-layout.spec.ts`.
- **Tracks**: layout never stops, replaces or resubscribes a track. Classmate cameras are
  subscribed only while the Classmates tab is visible (the `showClassmates` policy input).
- **Phones**: trainee camera share ≥ 75% at 390x844. Every dock control is on screen at
  44px. Nothing scrolls the document. The cue banner sits over the header.
- **Targets**: primary controls 44px, drag and resize handles at least 24px (WCAG 2.2
  target size), visible focus on the graphite surface.
- **Pointer + keyboard**: every drag has a keyboard path. Every resize exposes its value
  (`role="separator"` with `aria-valuenow`, or a labelled button with arrow keys).
- **Touch**: drag handles set `touch-action: none`. A press that moves less than 8px is a
  tap, so it keeps the tap behavior (for example showing the coach tile controls).
- **No re-render per pointer move**: drags write `transform`, size or a CSS variable to the
  element once per animation frame and commit React state on release. Re-rendering the
  room on every move competes with pose inference on iPhones.
- The look stays graphite (room tokens in the module). The app stays light only, with no
  theme toggles.

## 4. Steps

1. Name the region the change belongs to (table above). If none fits, stop and ask.
2. Put the geometry math in `room-layout.ts` and unit test it (`tests/room-layout.test.ts`).
3. Put the markup in the owning component. Room geometry goes in
   `meeting-workspace.module.css` and panel or shell geometry in `room-panel.module.css`.
   Don't add new global overrides to `globals.css` or `meeting.css`.
4. Capture 1440x900, 1024x768, 390x844 and 844x390 for **both** coach and trainee, plus the
   panel docked, floating and as a sheet. Use the isolated server and `example.test` fixtures
   only. The capture spec pattern is a temporary Playwright spec in the scratchpad, run with
   `local-coaching-check.mjs e2e --config <scratch config>` and `NODE_PATH=<repo>/node_modules`.
5. Run `tests/e2e/live-room-panel.spec.ts`, `coach-layout`, `meeting-gallery`,
   `trainee-mobile-layout`, `video-workspace`, `workspace`, `auth` and `a11y` with the
   isolated runner. Also run `webkit-mobile` via `--config playwright.webkit.config.ts`.
6. Run the `camera-contract-reviewer` and `ui-layout-reviewer` agents on the diff.
7. Report which viewports you saw and which you didn't. Browser runs are not proof that it
   works on a real phone.
