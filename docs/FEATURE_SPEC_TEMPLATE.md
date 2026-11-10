# Feature spec template

Copy this into the first message of a session (or into plan mode) before any code is
written. One spec = one session = one PR. If a section is hard to fill in, the feature
is not ready to build yet.

```md
## Feature: <one sentence, no "and">

**Who:** trainee | coach | studio owner | admin (pick one primary user)
**Device:** phone (390px, iPhone Safari) | desktop | both

**Today:** what the user does or sees now, and what is wrong with it.

**Done means** (each line is something you can check on a screen or in a test):
1. ...
2. ...
3. ...

**Must not change:**
- e.g. camera ownership / counting contract, existing API shapes, auth checks,
  44px controls, safe areas

**Out of scope:** things that are tempting but belong in a later PR.

**How I will verify:**
- [ ] `npm run typecheck && npm run lint && npm test`
- [ ] e2e spec added or updated: `tests/e2e/<name>.spec.ts`
- [ ] `node scripts/local-coaching-check.mjs` (if camera, coaching or records changed)
- [ ] Real device: <phone model + browser>, steps: ...
```

## Good vs vague

| Vague (produces churn) | Specific (produces a checkable result) |
| --- | --- |
| "Make the live room production grade" | "On a 390px phone the trainee's own camera fills the viewport; the end-call button stays visible and tappable (44px) while the rep counter is shown" |
| "Fix the counter" | "Squat count stops increasing after ~40 s on iPhone 13 Safari; repro: start guided squats, do 20 reps, count stalls at 11" |
| "Polish the studio page" | "Studio schedule list: align time column, remove the duplicate card wrapper, no layout shift when a class is added" |

## Reviewing the result

- Read the diff. Ask "why did this file change?" for any file outside the spec.
- Run `/code-review` before opening the PR.
- Camera and live-room changes are not done until they have been tried on a real phone.
