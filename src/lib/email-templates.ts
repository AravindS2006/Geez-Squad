/**
 * Transactional email bodies. Email clients ignore CSS variables and external
 * stylesheets, so colors are inlined here and mirror src/app/tokens.css.
 */
const color = {
  app: '#f7f7f5', // --surface-app
  card: '#ffffff', // --surface-1
  subtle: '#f4f4f2', // --surface-2
  text1: '#111111', // --text-1 / --brand
  text2: '#52524e', // --text-2
  text3: '#6b6b66', // --text-3
  border: '#e7e7e4', // --border-1
  accent: '#bef264', // --accent
  contrast: '#ffffff', // --brand-contrast
};
const sans = "'Inter','Segoe UI',Helvetica,Arial,sans-serif";
const serif = "Georgia,'Times New Roman',serif";

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export type RenderedEmail = { subject: string; text: string; html: string };

type EmailLayout = {
  subject: string;
  /** Hidden inbox preview line. */
  preheader: string;
  eyebrow: string;
  heading: string;
  greeting: string;
  paragraphs: string[];
  action: { label: string; url: string };
  /** Small print under the button: expiry and "ignore if this wasn't you". */
  note: string;
  /** Footer line saying why the reader got this email. */
  reason: string;
};

/** Every outgoing email goes through this one layout. All copy is escaped here. */
export function renderEmail(layout: EmailLayout): RenderedEmail {
  const subject = layout.subject.replace(/[\r\n]+/g, ' ').trim();
  const url = escapeHtml(layout.action.url);
  const p = (body: string, margin: string) =>
    `<p style="margin:${margin};font:400 15px/1.6 ${sans};color:${color.text2};">${escapeHtml(body)}</p>`;
  const text = [
    layout.greeting,
    '',
    ...layout.paragraphs.flatMap((body) => [body, '']),
    `${layout.action.label}: ${layout.action.url}`,
    '',
    layout.note,
    '',
    'Geez Squad — Stronger, together.',
    layout.reason,
  ].join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${color.app};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(layout.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${color.app};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 20px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="32" height="32" align="center" valign="middle" style="width:32px;height:32px;background:${color.text1};border-radius:8px;font:700 17px/32px ${sans};color:${color.contrast};">G</td>
<td style="padding-left:10px;font:700 16px/1 ${sans};color:${color.text1};letter-spacing:-0.2px;">Geez Squad</td>
</tr></table>
</td></tr>
<tr><td style="background:${color.card};border:1px solid ${color.border};border-radius:16px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td height="6" style="height:6px;line-height:6px;font-size:0;background:${color.accent};">&nbsp;</td></tr>
<tr><td style="padding:36px 36px 8px;">
<p style="margin:0 0 12px;font:700 11px/1.4 ${sans};letter-spacing:1.4px;text-transform:uppercase;color:${color.text3};">${escapeHtml(layout.eyebrow)}</p>
<h1 style="margin:0 0 20px;font:400 30px/1.2 ${serif};color:${color.text1};">${escapeHtml(layout.heading)}</h1>
${p(layout.greeting, '0 0 12px')}
${layout.paragraphs.map((body, i) => p(body, i === layout.paragraphs.length - 1 ? '0 0 28px' : '0 0 12px')).join('\n')}
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${color.text1}" style="border-radius:999px;background:${color.text1};">
<a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:15px 30px;font:600 15px/1 ${sans};color:${color.contrast};text-decoration:none;border-radius:999px;">${escapeHtml(layout.action.label)}&nbsp;&rarr;</a>
</td></tr></table>
<p style="margin:24px 0 0;font:400 13px/1.6 ${sans};color:${color.text3};">${escapeHtml(layout.note)}</p>
</td></tr>
<tr><td style="padding:24px 36px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:14px 16px;background:${color.subtle};border-radius:12px;font:400 12px/1.6 ${sans};color:${color.text3};">
Button not working? Copy and paste this link into your browser:<br>
<a href="${url}" target="_blank" rel="noopener" style="color:${color.text1};text-decoration:underline;word-break:break-all;">${url}</a>
</td></tr></table>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:24px 16px 0;font:700 11px/1.6 ${sans};letter-spacing:1.4px;text-transform:uppercase;color:${color.text3};">Stronger, together.</td></tr>
<tr><td align="center" style="padding:4px 16px 0;font:400 12px/1.6 ${sans};color:${color.text3};">${escapeHtml(layout.reason)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}

function greet(name?: string | null) {
  const firstName = (name || '').trim().split(/\s+/)[0] || '';
  return firstName ? `Hi ${firstName},` : 'Hi there,';
}

function duration(minutes: number) {
  if (minutes >= 1440 && minutes % 1440 === 0)
    return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes >= 60 && minutes % 60 === 0)
    return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
}

export function verificationEmail({
  name,
  url,
  expiresInMinutes = 60,
}: {
  name?: string | null;
  url: string;
  expiresInMinutes?: number;
}): RenderedEmail {
  return renderEmail({
    subject: 'Verify your Geez Squad email',
    preheader: 'Confirm your email to finish setting up your Geez Squad account.',
    eyebrow: 'Confirm your email',
    heading: 'One tap and you’re in.',
    greeting: greet(name),
    paragraphs: [
      'Welcome to Geez Squad. Confirm this is your email address to finish setting up your account and join your studio’s classes, coaching and progress.',
    ],
    action: { label: 'Verify my email', url },
    note: `This link expires in ${duration(expiresInMinutes)}. If you didn’t create a Geez Squad account, you can safely ignore this email.`,
    reason: 'You’re receiving this because this address was used to sign up for Geez Squad.',
  });
}

export function passwordResetEmail({
  name,
  url,
  expiresInMinutes = 60,
}: {
  name?: string | null;
  url: string;
  expiresInMinutes?: number;
}): RenderedEmail {
  return renderEmail({
    subject: 'Reset your Geez Squad password',
    preheader: 'Use this link to choose a new Geez Squad password.',
    eyebrow: 'Password reset',
    heading: 'Let’s get you back in.',
    greeting: greet(name),
    paragraphs: [
      'We received a request to reset the password for your Geez Squad account. Choose a new password using the button below.',
    ],
    action: { label: 'Reset my password', url },
    note: `This link expires in ${duration(expiresInMinutes)} and can be used once. If you didn’t ask to reset your password, ignore this email and your password stays the same.`,
    reason:
      'You’re receiving this because a password reset was requested for your Geez Squad account.',
  });
}

export function membershipSetupEmail({
  studioName,
  url,
}: {
  studioName: string;
  url: string;
}): RenderedEmail {
  return renderEmail({
    subject: `${studioName}: connect your membership`,
    preheader: `Your ${studioName} membership is ready to connect.`,
    eyebrow: 'Membership ready',
    heading: 'Your spot is saved.',
    greeting: 'Hi there,',
    paragraphs: [
      `${studioName} has set up your studio membership on Geez Squad.`,
      'Sign up or sign in using this email, verify your mailbox, and accept the studio request inside the app. Your membership and history remain saved if you connect later.',
    ],
    action: { label: 'Open Geez Squad', url },
    note: 'If you weren’t expecting this, you can ignore this email. Nothing is shared until you accept the request.',
    reason: `You’re receiving this because ${studioName} added this address as a member.`,
  });
}

export function coachInvitationEmail({
  studioName,
  url,
  expiresInDays = 7,
}: {
  studioName: string;
  url: string;
  expiresInDays?: number;
}): RenderedEmail {
  return renderEmail({
    subject: `${studioName}: coach invitation`,
    preheader: `You’ve been invited to coach at ${studioName}.`,
    eyebrow: 'Coach invitation',
    heading: 'Join the coaching team.',
    greeting: 'Hi there,',
    paragraphs: [
      `You’ve been invited to coach at ${studioName} on Geez Squad.`,
      'Sign up or sign in with this email, verify your mailbox, then accept the coach request inside the app.',
    ],
    action: { label: 'Accept in Geez Squad', url },
    note: `This request expires in ${duration(expiresInDays * 1440)}. If you weren’t expecting it, you can ignore this email.`,
    reason: `You’re receiving this because ${studioName} invited this address to its coaching team.`,
  });
}
