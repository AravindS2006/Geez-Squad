// Authentication/connectivity check only: never sends an email or prints secrets.
import nodemailer from 'nodemailer';
const port = Number(process.env.SMTP_PORT || 465);
if (
  !process.env.SMTP_HOST ||
  !process.env.SMTP_USER ||
  !process.env.SMTP_PASSWORD ||
  ![465, 587].includes(port)
)
  throw new Error(
    'Configure SMTP_HOST, SMTP_USER, SMTP_PASSWORD and a TLS port before running this check.',
  );
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  requireTLS: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  logger: false,
  debug: false,
});
try {
  await transport.verify();
  console.log(
    'SMTP connection and authentication passed. Test actual verification and recovery delivery before production cutover.',
  );
} catch {
  console.error(
    'SMTP verification failed. Check the mailbox authorization, TLS settings and provider sending restrictions.',
  );
  process.exitCode = 1;
}
