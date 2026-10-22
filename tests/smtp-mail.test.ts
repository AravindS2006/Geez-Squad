import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const smtp = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.create } }));
import { sendMail } from '../src/lib/mail';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
function setup() {
  vi.stubEnv('EMAIL_DELIVERY', 'smtp');
  vi.stubEnv('SMTP_HOST', 'smtp.gmail.com');
  vi.stubEnv('SMTP_PORT', '465');
  vi.stubEnv('SMTP_USER', 'fixture@gmail.com');
  vi.stubEnv('SMTP_PASSWORD', 'private-app-password');
  vi.stubEnv('EMAIL_FROM', 'fixture@gmail.com');
  smtp.create.mockReturnValue({ sendMail: smtp.send });
}
it('uses encrypted SMTP with raw message logging disabled', async () => {
  setup();
  smtp.send.mockResolvedValue({});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  await sendMail('client@example.test', 'Verify your account', 'private-token-url');
  expect(smtp.create).toHaveBeenCalledWith(
    expect.objectContaining({
      secure: true,
      requireTLS: true,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    }),
  );
  expect(smtp.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'client@example.test' }));
});
it('keeps credentials and email contents out of errors and logs', async () => {
  setup();
  const error = Object.assign(new Error('private-app-password private-token-url'), {
    code: 'EAUTH',
  });
  smtp.send.mockRejectedValue(error);
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(sendMail('client@example.test', 'Verify', 'private-token-url')).rejects.toThrow(
    'Email could not be delivered.',
  );
  expect(output.mock.calls.flat().join(' ')).not.toMatch(
    /private-app-password|private-token-url|client@example/,
  );
  expect(output.mock.calls.flat().join(' ')).toContain('EAUTH');
});
