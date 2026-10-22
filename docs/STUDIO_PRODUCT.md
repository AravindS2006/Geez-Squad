# Geez Squad studio product phase

Implemented 19 October 2026. Geez Squad now combines physical studio operations with the existing online coaching product.

## Entry points

- `/` is a public, responsive studio landing page. Its calls to action lead to sign-in/onboarding or the explicitly labelled sample studio.
- `/app` is the authenticated workspace; studio owners open the operations dashboard, while trainees retain their personal coaching overview.
- `/demo` is an illustrative studio. All member records, collections, staff, enquiries and attendance are sample data. Edits last only for the current workspace session and reset on refresh.

The operations navigation includes Dashboard, Members, Memberships, Attendance, Payments, Enquiries, Team, Studio classes, and Studio details. Live sessions, coaching clients, workout plans and progress tools remain available alongside them.

## Daily workflows

1. Create available membership plans with a price in INR and a duration in days. Plan edits apply to future assignments; existing terms preserve the agreed name, fee and dates.
2. Add members with or without email addresses. Email is normalized, and duplicate non-empty member emails are blocked within a studio. Members may be active, paused or archived; pausing does not extend the membership dates automatically.
3. Assign a plan to a member. Membership terms include the starting day and cannot overlap. Renewals create a new term, preserving history. The renewal form starts after the latest existing term when opened from a member or membership row.
4. Record received payments against a term. Partial payments, payment methods, references, printable receipts, and CSV exports are supported. Payment request IDs make network retries idempotent. Transactions reject overpayment, including concurrent final payments. Paid terms cannot be cancelled; unpaid terms can be marked cancelled without removing their history.
5. Check in members with a valid membership on the chosen date. Check-ins are unique per member and date. Future attendance is rejected. Studio attendance is separate from camera activity, saved workouts and video-session enrollment.
6. Schedule physical studio classes with trainer, room, start time, duration and capacity. Book members into a separate roster. Membership must cover the class date; full classes reject new bookings. Cancel a booking to release its place. Completed and cancelled classes retain their history. Future classes cannot be marked completed. Live video sessions keep their existing scheduling and enrollment flow.
7. Track enquiries through new, contacted, trial, joined and closed stages, with source, notes and follow-up dates. A joined enquiry can prefill a new member record. Enquiry tracking does not send email, SMS or WhatsApp messages.
8. Maintain the staff directory and studio address, contact number and opening hours. Staff directory entries do not grant login permissions or payroll access.

The dashboard derives all operational numbers from saved data: active memberships, recorded monthly collections, unique daily visits, renewal follow-ups, outstanding balances, enquiries and upcoming physical/online sessions. Blank studios start with blank operational data. Sample numbers are restricted to `/demo`.

## Member accounts and access

Physical members do not need app accounts. Adding a member with an email creates an in-app request automatically. After signing up with a personal email and verifying it, the client accepts once to connect their membership and coaching access. Contact email edits do not transfer account ownership. See [account and membership upgrade](ACCOUNT_MEMBERSHIP_UPGRADE.md) for migration, email, and participation rules.

Operations reads and writes require the authenticated owner of that studio. Every referenced member, plan, term, staff record, enquiry and class is checked within that studio. Members cannot fetch the owner dashboard. Mutations use origin checking, bounded JSON bodies, input validation, rate limits and audit events. Financial and capacity changes run in serializable transactions with the existing SQLite queue and PostgreSQL conflict retry helper.

Dates in operational registers use Asia/Kolkata. Physical class times are entered in India time and stored as UTC instants. Fees and payment amounts are integer paise and display fractional rupees without rounding them away. CSV cells are quoted and spreadsheet formula prefixes are escaped.

## Database and release

Two additive migrations are supplied for both SQLite and PostgreSQL:

- `20261019000000_studio_operations`: member register, offers, terms, payments, attendance, enquiries, staff and studio details.
- `20261019010000_studio_classes`: physical classes and booking rosters.

Both migrations are applied to the local SQLite database and to the existing production PostgreSQL database. After the initial Git deployment omitted the production migrations, they were rehearsed in an isolated PostgreSQL schema and applied on 19 October without changing existing accounts. Canonical production sign-in and studio operations passed 25 checks; see the [deployment repair](LOGIN_DEPLOYMENT_FIX.md). For later schema releases, test the PostgreSQL migrations in an isolated Neon branch, apply them using the direct connection migration workflow, run the migration-readiness check, then deploy. Preserve the existing production identity, video and billing configuration.

Run `npm run test:studio` against the local server for disposable-account API acceptance. The script checks membership assignment, duplicates and overlaps, payment replay and concurrent balance protection, attendance, physical-class capacity, cross-studio isolation, personal membership access and remaining directories; it removes its own test accounts afterward. The browser acceptance test is `tests/e2e/studio-operations.spec.ts` and covers a persisted mobile member-to-booking journey and automated accessibility checks.

Initial local acceptance: 330 unit tests passed; 51 studio API checks passed; the persisted mobile member-to-booking journey passed; all 10 new-page accessibility scans had zero automated violations; desktop and mobile landing/dashboard captures were reviewed; mobile page-width containment passed. Fifteen browser cases passed across the selected suites, covering the new operations journey, public entry, coaching management, live preview, workout setup, galleries, mobile navigation, owner signup, delayed-script session controls, and the trainee invitation/enrollment/completion flow. The final three authentication cases ran against the optimized local production build. TypeScript, formatting, the optimized build, diff checks and PostgreSQL schema validation passed. Subsequent production migration and sign-in acceptance are recorded in the deployment repair linked above.

## Scope boundaries

This release records payments that the operator has already received; it does not charge members through a payment gateway. Receipts are payment acknowledgements, not a GST invoice engine. Staff permissions, payroll, expense accounting, automated messaging, automatic recurring renewals, class waitlists and member self-service physical-class booking are not implemented. Physical-class rosters are currently managed by the owner. The public landing page does not invent studio addresses, trainers’ qualifications or business testimonials. Configure real offers, staff and contact details in the owner workspace.

## Generated visual asset

The built-in image-generation tool created `public/images/studio-hero.png`, copied into this repository and served through Next.js image optimization. The image is illustrative, not a photograph of the actual studio or its members.

Final prompt:

> Use case: photorealistic-natural. Asset type: website hero photograph for Geez Squad, a premium welcoming fitness studio in India. A candid editorial photograph of two adult South Asian athletes, woman foreground in forest-green training clothes and man slightly behind, doing a strength training session with dumbbells in a beautifully minimal warm concrete boutique fitness studio. Athletic everyday bodies, determined but friendly mood, natural afternoon window light from the side, tactile film grain, premium sports magazine photography, olive and warm neutral palette with a little lime detail. Portrait composition suitable for cropping into a tall website panel. Keep faces and dumbbells fully visible. No text, no logos, no watermarks. Save the generated asset for project use.
