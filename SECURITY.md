# Repository security

Configure production credentials in the hosting provider. Never put them in source,
environment templates, screenshots, issue comments, or browser traces. The two
tracked `.env` examples contain only blank values and documented placeholders.
Camera recordings and pose diagnostics stay local unless a separate consented
research process explicitly permits sharing.

Before pushing, run `npm run security:scan`. This checks public file boundaries and
scans the full local Git history with fully redacted Gitleaks output. CI repeats the
checks with Gitleaks 8.30.1, verified against its pinned release checksum, and fetches
the complete repository history. No scan reports or browser traces are uploaded.

Install [Gitleaks](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1) from
the official release and verify its checksum. Place the executable on `PATH`, set
`GITLEAKS_BIN`, or put it in the ignored `.vercel/security-tools/` directory. Run
`npm run security:install-hooks` once per checkout to enable the local pre-push
guard. It fails closed when the scanner is unavailable. Hooks are local settings;
cloning the repository does not enable them automatically.

GitHub secret scanning and push protection are enabled for this public repository.
These checks reduce risk, but cannot prove that every possible secret format is
absent. Do not bypass a warning without reviewing it.

If an actual credential is exposed, revoke or rotate it with its provider first,
update the affected deployment, and inspect access logs. Removing a line does not
remove existing public history or copies. Arrange any necessary history cleanup
with the maintainer; never post the credential in a public report.

The PostgreSQL migration job uses a random password for each disposable CI
container, binds its port only to loopback, and removes the container after the
job. Production database credentials are never provided to this job.

See the [2026-10-24 audit](docs/SECURITY_AUDIT_2026-10-24.md) for the reviewed
GitGuardian finding and the scope and limits of the verification.
