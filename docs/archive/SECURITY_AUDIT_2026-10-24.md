# Public repository security audit — 2026-10-24

## Finding and impact

GitGuardian incident 38945344 on PR #1 identified the fixed password in the
disposable PostgreSQL CI service introduced by commit `484acd8`. The migration
rehearsal connects only to localhost or 127.0.0.1; the CI runner and database are
temporary. This value was not the production database password and does not grant
access to production. There was no evidence of a production credential exposure.

The fixed CI password and the rehearsal's matching connection-string fallback
have been removed. The job now creates a cryptographically random credential in
memory for each run, masks it, binds a dynamic port only to 127.0.0.1, and cleans
up its container. Manual rehearsals must explicitly supply `POSTGRES_TEST_URL`
for a disposable local database. Production is rejected by the hostname check.

The old test value remains in public history and the historical PR discussion.
Rewriting history would not revoke public copies and is unnecessary for this
expired, disposable test credential. The corresponding GitGuardian incident can
be classified as a test credential after reviewing this evidence; removing the
line does not automatically close a historical incident.

## Evidence

The initial audit covered all fetched branches and PR #1's head, including deleted
file versions: 36 reachable commits, 796 unique file blobs, and 315 historical
paths. Gitleaks 8.30.1 scanned the complete history with full output redaction and
found no secrets. It was obtained from the official release and checksum-verified.

An additional in-memory comparison against seven distinct locally configured
credential values found no matches in any historical file blob. Actual values
were never printed or added to the repository. Candidate password assignments
were reviewed as placeholders, generated values, or disposable test fixtures.
Personal-mail-domain candidates were UI placeholders or SMTP test fixtures.

No private `.env` files, deployment metadata, local databases, cookies, browser
state, camera recordings, or diagnostic archives appeared in the Git history.
The two tracked environment examples contain placeholders or blank credentials.

Both release CI runs had no published artifacts. The two retained diagnostic
artifacts from October 22 were also downloaded and reviewed locally: 91 extracted
files and 30 network entries, all using localhost, with no cookies or authorization
headers. Their nested trace archives passed Gitleaks, and no configured credentials
were found. These were disposable demo/model-test traces, not customer sessions.

The production landing, login, and demo pages and their 19 referenced JS/CSS assets
contained no matches for the configured credentials. The assets also underwent a
separate secret scan. Requests for `.env`, `.env.local`, `.git/config`, Vercel
project metadata, and two local database paths returned 404. These checks used
anonymous GET requests and made no changes to customer data.

## Prevention

- Enabled GitHub secret scanning and repository push protection, previously off.
- Added a complete-history Gitleaks CI job with a pinned executable checksum.
- Added private-path and environment-template guards, with regression coverage.
- Added an opt-in local pre-push guard; enabled it in the release checkout.
- Removed automatic diagnostic artifact uploads because traces can capture cookies
  and request bodies, even though the reviewed archives did not contain them.
- Set CI permissions to read-only contents and disabled persisted checkout tokens.
- Expanded Git and Vercel ignore rules for key files, exports, and request captures.

## Limits

This audit found no production credential or private-file exposure in the reviewed
material. It is not proof that every possible secret format is absent. It does not
audit third-party copies, personal GitHub metadata, unknown external branches, or
the complete security of every application feature. Public source, commit author
metadata, issue discussions, and deployment URLs remain intentionally public.
The GitGuardian dashboard's historical incident status is separate from the code
fix and GitHub's native secret scanning.
