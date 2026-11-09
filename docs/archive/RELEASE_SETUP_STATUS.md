# Geez Squad production setup status

Updated 9 October 2026 for the Geez Squad release. The canonical app origin is [geez-squad.vercel.app](https://geez-squad.vercel.app). Full physical-device, accuracy and public-launch acceptance remain separate work; see [VERIFICATION.md](../VERIFICATION.md).

| Item | Status |
| --- | --- |
| Vercel project | `aravinds2006s-projects/geez-squad`, `prj_m5uOzEvrg5TZ44AKN2CJ2jRJlERK`; local `.vercel/project.json` linked |
| Assigned app domain | `geez-squad.vercel.app`; publicly serving the app with HTTPS |
| Build/runtime | Next.js, `npm ci`, guarded `npm run build:vercel`, Node 22.x, functions in Singapore `sin1` |
| Domain assignment | Custom-domain auto-assignment is disabled. Check the exact staged commit and successful CI before promotion; verify alias assignment afterward |
| GitHub | Public `AravindS2006/Geez-Squad` repository (existing visibility preserved during rename), source pushed; `master` tracks `origin/master`; credentials, databases, builds, agent packages and generated assets excluded |
| Vercel Git connection | Existing project connected to `AravindS2006/Geez-Squad`; Production Branch is `master` |
| Auth and cleanup | Independent generated secrets stored as sensitive Production variables; origin and PostgreSQL provider set |
| PostgreSQL | Dedicated `geez-squad-production` Neon Free resource, Singapore, Better Auth retained, connected only to Production; pooled URL and DIRECT_URL configured |
| Migration and account flow | Init, training insights and nullable session-room identity migrations are applied. Account/history tables and credentials are retained; temporary test schemas/accounts are cleaned up |
| LiveKit Cloud | Display name saved as Geez Squad; existing project ID, service URL and credentials retained. Real Cloud transport checks use a coach and two simultaneous trainees. Automatic room creation is off |
| Email | Resend signup completed; `EMAIL_DELIVERY=test` selected for operator testing without a domain. Signup/sign-in enabled, email addresses remain unverified, and mail delivery/recovery are deferred |
| Required app keys | Nine core keys are present plus explicit email deferral; RESEND_API_KEY and EMAIL_FROM are needed only when EMAIL_DELIVERY=resend |
| Billing | Disabled; paid entitlements and live payment verification remain future work |
| Application deployment | Git push triggers a remote production build; check READY state, successful CI and canonical URL against the released commit after each change |
| Local app | Local SQLite setup preserved; stop the server before Prisma generation/build on Windows |
| Verification suite | 191 unit cases, 111 API checks, 28 browser cases and 20 public/sample axe states; isolated deferred-email and two-role testing signup checks are included in CI. Diagnostics never print credentials |

Open [Vercel environment settings](https://vercel.com/aravinds2006s-projects/geez-squad/settings/environment-variables) and [LiveKit Cloud](https://cloud.livekit.io), then enter the LiveKit credentials directly in Vercel Production. Never paste keys in chat. Defer Resend credentials until a domain whose DNS you control is available; the assigned Vercel app subdomain cannot be used to verify the `vercel.app` email domain. [Resend verified-domain requirements](https://resend.com/docs/dashboard/domains/introduction).

The initial database request was rejected by automatic approval review over unspecified billing/resource creation. The user subsequently approved the exact Neon Free plan; provisioning completed after the owner accepted Marketplace terms. That approval issue is resolved.

Follow DEPLOYMENT.md for release commands. The `profile-v4` scores are geometric estimates for coach review. Physical-camera accuracy, peak database/RTC concurrency, delivered email and independent launch review remain documented in VERIFICATION.md. Existing LiveKit service hostnames and historical migration/storage compatibility identifiers may retain the old prefix; replacing these identifiers would disrupt existing connections or data.
