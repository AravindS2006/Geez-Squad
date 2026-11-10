# Test as a coach and trainee

The hosted testing app is at [geez-squad.vercel.app](https://geez-squad.vercel.app/login). A purchased domain is unnecessary for this testing flow. Vercel provides HTTPS for camera access.

## Create both accounts

1. In your normal browser window, open [Create account](https://geez-squad.vercel.app/login?mode=signup). Enter your name, an email address you control, and a password of at least 12 characters. Open the verification email and follow its link before signing in.
2. On the setup screen, choose **I'm a coach**, enter a studio name, confirm you are 18+, and select **Create my workspace**. Trainer and coach refer to the same role in this app.
3. Open a private/incognito window, another browser profile, or a second device. Create another account with a different email address you control. Choose **I'm a trainee** and complete setup. Ordinary tabs in the same browser profile share a login, so they cannot represent two independent accounts.

Role selection is one-time. Use two separate accounts rather than switching a single account between roles. Production requires a verified email address; forgotten passwords are reset by email.

## Connect the two accounts

1. In the coach window, open **Clients → Invite client**. Enter the trainee's exact signup email and select **Create invite link**.
2. Copy the invitation link manually into the trainee window. Select **Join studio**. Invitations expire after seven days, can be used once, and require the matching account email. Possession of the secret invitation link is required even in testing mode.
3. In the coach window, open **Sessions → Schedule session**. Choose a future start time, select the trainee, and save the session.
4. Open the studio as the coach and select **Start class**. Open **Sessions** in the trainee window and open that same studio.
5. Enable the camera, grant browser permission, confirm the group video consent, and select **Join live video**. The coach can join video, send personal cues, change exercises, pause, and end the session. The trainee can request help and see their own analysis.

For an actual video workout, use a computer for the coach and a phone or another computer for the trainee. Allow camera/microphone access on both devices. Keep the trainee's full body visible and one person in frame. Live video requires configured LiveKit Cloud credentials; local pose practice is also available at [/demo?view=practice](https://geez-squad.vercel.app/demo?view=practice). Camera scores are heuristic feedback for coach review.

## Enable verified email later

When you control a sending domain, verify it in Resend using the provided DNS records. In Vercel Production, add the domain's `EMAIL_FROM` and its `RESEND_API_KEY`, change `EMAIL_DELIVERY` to `resend`, and redeploy. The UI then offers email recovery and requires verification for signup/sign-in. Existing unverified testing accounts receive a verification link when they attempt to sign in with their password. Existing unverified sessions cannot access protected app APIs after the switch. Users keep their studio and workout records; their addresses are never silently marked verified.

Test actual verification and reset-link delivery before inviting clients. `EMAIL_DELIVERY=test` is limited to local and isolated test runs.
