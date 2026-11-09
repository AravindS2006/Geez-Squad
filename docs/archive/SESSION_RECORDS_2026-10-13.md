# Session scheduling, timing, access, and exercise records

The requested “recording” work concerns saved exercise records, not audio/video recording. No recording service, deployment, database migration, or production configuration change is part of this patch.

## Findings and corrections

| Finding | Correction |
| --- | --- |
| Session time continued increasing after completion; polling omitted the actual end time. | Polling returns `endedAt`. Elapsed time uses actual start/end timestamps and freezes when the class ends. Class pauses remain included in meeting wall-clock time, distinct from measured exercise active time. Completed classes display “completed” rather than “Paused.” |
| An open waiting room retained its old title, schedule, duration, and workout after a coach edit. | Poll responses include those current fields. Pending or superseded coach controls prevent an older poll from overwriting their result. |
| Polling replaced participant objects without their historical summaries. Trainees saw their private one-person roster as the entire class size. | Poll responses retain authorized summaries and include a separate total enrollment count. Other trainees' identities and exercise metrics remain private. |
| The latest-100 query could exclude live and nearest scheduled classes behind far-future schedules. Completed lists displayed oldest first. | Queries independently bound each status, select schedules ascending and history descending, and prioritize live classes in the UI. Direct authorized room URLs remain independent of list limits. |
| Local inputs inside daylight-saving gaps silently shifted forward. Metadata-only edits could change repeated-hour instants and discard seconds. | Local inputs are round-trip validated. An unchanged local input preserves the original instant. The form previews start, end, and UTC offset. Newly entered repeated hours use the browser's earlier occurrence, with its offset shown. |
| Shared room links lost their destination at login. The auth SDK's callback to `/login` also raced app navigation. | Login preserves an allowlisted room path. SDK and app navigation use the same authenticated destination. External, traversal, and encoded destinations are rejected. Invitation handling retains precedence. |
| Setup was unclear before a class started; unavailable video appeared as a disabled join action. | The waiting room explains schedule, time zone, and next steps, with a copy-link action. During live calls, details move into Options to preserve gallery space. Unavailable video is labeled explicitly. |
| In-flight media setup could continue after a class ended or the user left. | End-state polling invalidates the join generation, closes consent, and disconnects. Asynchronous audio/camera/microphone setup checks whether the join is still current. |
| Device retry storage silently discarded all but the latest 100 unsent exercise records. | Queue reads no longer truncate records. Account ownership and idempotent server writes are retained. |
| Pending saves were difficult to recover after leaving the camera. Insights displayed only 50 records even when more were loaded. | Insights offers pending-save retries and refreshes persisted history afterward. “Show more exercise records” reveals additional loaded records in batches of 50. |
| A plank with zero hold time displayed “0 reps,” its target lacked units, and it displayed unavailable rep quality instead of measured form. | Hold records always use seconds, targets include units, and holds display form estimates. Expandable details show active/tracked time, range, tempo, reported load, and rule version; missing measurements remain unavailable. |

## Verification

The verification path is UI → authenticated API → isolated SQLite database → polling/reload → visible result. External email, billing, and LiveKit credentials are disabled. Disposable accounts and their related records are removed afterward.

- **323 unit tests across 26 files** pass, including the pose suite, new timing and safe-login checks, and a queue exceeding 100 unsent records.
- The optimized Next.js build and TypeScript checks pass.
- **180 API checks** pass, including updated schedule/workout polling, end timestamps, authorized summaries, ownership, lifecycle, metrics, and exports.
- **18 distinct browser cases** pass across session/record regressions, studio management, saved camera training, meeting galleries, authentication, and workspace navigation. These cover shared-link login, live prioritization behind 101 future schedules, rescheduling an open room, actual start/end timing, DST gaps and repeated hours, pending exercise recovery, database reload, hold units, and more than 50 records.
- Gallery regressions pass for 8, 30, and 48 trainees at 320×568, 390×844, 844×390, 1440×900, and 3840×2160. Testing caught insufficient gallery space in the first schedule-panel layout; moving live details to Options corrected it.
- Relevant room, dialog, and exercise-history accessibility scans pass after correcting waiting-room message contrast. Automated scans do not establish complete accessibility conformance.

## Scope and remaining limits

The session list contains up to 100 entries per status. Workout data still loads the latest 500 sets and 100 check-ins. The new record button reveals those loaded sets, not unlimited lifetime history; backend history pagination remains separate work.

Pending records require the same browser origin and account. Removing the queue limit cannot recover previously discarded records or bypass storage quota, blocked storage, or cleared browser data. Existing validation still rejects records older than 30 days or inconsistent records; retry does not bypass it.

Meeting duration is planned and does not automatically terminate a coach's class. Meeting time includes pauses; exercise records store observed active/tracked time. Polling can be delayed by a lost connection. Production LiveKit transport and physical devices have not been revalidated by these local checks.

The installed verification runtime is Node 22.14.0; the repository declares Node 22.22+. CI/release acceptance should also use the declared runtime.

## Technical basis

MDN documents that [`datetime-local`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/datetime-local) has no time-zone field and can accept a time inside a daylight-saving gap. Its [Date reference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date) explains repeated-hour and nonexistent-time disambiguation. These behaviors motivated round-trip validation and preserving unchanged instants.

Next.js changes follow the installed client-component and redirect guides. The sign-in race was confirmed in the installed Better Auth implementation (`client/fetch-plugins.mjs` and `api/routes/sign-in.mjs`) and reproduced in the browser before correction.
