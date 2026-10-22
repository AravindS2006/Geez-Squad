# Accounts, membership access, and diagnostics

Clients use personal email/password accounts. Better Auth and existing credential records are preserved. A verified email is required before accepting an in-app studio request; testing mode does not bypass this identity check.

## One member workflow

1. In Members, add the client's name and optional personal email. A membership offer and start date may be assigned in the same save.
2. Their studio record and membership term are saved immediately. An email address creates an in-app request automatically, including when the account is created later.
3. The verified client signs in and accepts the studio request once. Acceptance atomically connects the member record and coaching access. No separate Coaching clients invitation is required.
4. Members shows Pending confirmation, Connected, No email, or a declined/withdrawn request. The owner can explicitly resend or withdraw an unaccepted request.

Account ownership uses `StudioMember.userId`, not mutable contact email. Changing contact email does not transfer history. Coach profile edits change the studio's name/goal record, leaving the client's global account profile intact. Accepted legacy links remain supported.

Physical members can remain offline. Accepting a studio connection grants consent to coaching visibility; it does not fabricate a financial membership. Each account has one accepted studio. Existing accepted clients are backfilled only when matches are unambiguous.

## Participation and history

An active member status and a non-cancelled term covering the relevant India date are required. Scheduling checks the class date; joining and live actions check the current date. Outstanding balances do not block an otherwise valid term. Coaches retain owner controls.

Pausing/archiving a member or cancelling their qualifying term cancels invalid future physical bookings while retaining cancellation history. Live token requests and actions are rejected immediately once the database change commits. Connected participants are removed through LiveKit; live polling rechecks eligibility and retries cleanup. This is polling-based enforcement, not a guarantee of instantaneous disconnection. A room-service outage is logged and retried.

Own membership, payments, visits, completed sessions, personal practice, wellness check-ins and exports remain readable after expiry. Completed historical workout uploads retain the original consent and session-time checks. Staff directory entries remain directory records, not login permissions.

## Free Gmail sending

Configure Vercel Production variables directly:

| Variable | Value |
| --- | --- |
| `EMAIL_DELIVERY` | `smtp` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | Authorized Gmail mailbox |
| `SMTP_PASSWORD` | Mailbox's Gmail app password |
| `EMAIL_FROM` | Same mailbox; optional `Geez Squad <address>` display name |

The sender can initially be the operator's personal mailbox. Recipients can use any personal email provider. Gmail sending limits and provider restrictions apply; this configuration introduces no paid email service or purchased domain. Gmail app passwords require 2-Step Verification. See [Nodemailer's Gmail guide](https://nodemailer.com/guides/using-gmail) and [Google's app-password instructions](https://support.google.com/mail/answer/185833).

`npm run mail:verify` checks connection/TLS/authentication using securely supplied environment variables. It does not send a message. Test actual verification and password-reset receipt before public cutover. Never mark testing accounts verified as a migration shortcut. Resend remains available through the existing mode.

## Migration and release

The additive `20261022000000_member_accounts` migration adds a nullable account link and the join-request table. It does not modify User, Account or Session records. Apply migrations before deploying, because the release and health gates validate schema readiness.

Run `npm run db:members:check` with the matching generated Prisma client and target environment. It prints counts and opaque conflict IDs only. Resolve conflicts before applying. `npm run db:members:backfill` links accepted legacy members, creates missing studio records, and creates requests for unlinked emailed members. It preserves credentials, verification flags, dates, terms and payments. Rerunning is idempotent. Production uses the PostgreSQL client (`npm run db:postgres:generate`); local development uses SQLite (`npm run db:generate`).

Clients without valid terms retain history but require an actual membership before live participation. Review missing-term counts and live sessions before enabling the new release.

## Finding errors

Set `LOG_LEVEL=debug|info|warn|error`; production defaults to info. Structured logs include request ID, route, method, action, response status, duration and safe failure codes. Search Vercel runtime logs by the support reference shown to the user. Server-render errors use the Next.js error digest. Request headers also expose `X-Request-ID`.

Logs allow known metadata fields only. They exclude bodies, credentials, email contents, camera/audio data, member notes and payment references. Debug mode never enables SMTP protocol or message-body logging. Meeting options contains opt-in connection diagnostics and a copy button; the copied report contains connection/device flags and timestamps only.
