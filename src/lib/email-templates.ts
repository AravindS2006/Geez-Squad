/**
 * Transactional email bodies. Email clients ignore CSS variables and external
 * stylesheets, so colors are inlined here and mirror src/app/tokens.css.
 */
const color = {
  app: '#f7f7f5', // --surface-app
  card: '#ffffff', // --surface-1
  subtle: '#f4f4f2', // --surface-2
  text1: '#111111', // --text-1 / --brand / --surface-inverse
  text2: '#52524e', // --text-2
  text3: '#6b6b66', // --text-3
  inverse: '#fafaf9', // --text-inverse
  border: '#e7e7e4', // --border-1
  accent: '#bef264', // --accent (lime, the .button.lime background)
  accentSoft: '#ecfccb', // --accent-soft
  accentEdge: '#a3e635', // .button.lime hover shade, used as the button border
  onAccent: '#1a2e05', // .button.lime text
  success: '#3f6212', // --success
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
  /** Optional numbered steps shown after the paragraphs. */
  steps?: string[];
  action: { label: string; url: string };
  /** Small print under the button: expiry and "ignore if this wasn't you". */
  note: string;
  /** Footer line saying why the reader got this email. */
  reason: string;
};

/**
 * Every outgoing email goes through this one layout. All copy is escaped here. The HTML
 * has exactly one link, the button; the plain-text part keeps the URL because text-only
 * mail clients show that part instead of the HTML.
 */
export function renderEmail(layout: EmailLayout): RenderedEmail {
  const subject = layout.subject.replace(/[\r\n]+/g, ' ').trim();
  const url = escapeHtml(layout.action.url);
  const steps = layout.steps ?? [];
  const p = (body: string, margin: string) =>
    `<p style="margin:${margin};font:400 16px/1.65 ${sans};color:${color.text2};">${escapeHtml(body)}</p>`;
  const text = [
    layout.greeting,
    '',
    ...layout.paragraphs.flatMap((body) => [body, '']),
    ...(steps.length ? [...steps.map((step, i) => `${i + 1}. ${step}`), ''] : []),
    `${layout.action.label}: ${layout.action.url}`,
    '',
    layout.note,
    '',
    'Geez Squad — Stronger, together.',
    layout.reason,
  ].join('\n');
  // Brand mark built from table cells (most email clients strip inline SVG).
  const mark = (size: number, tile: string, letter: string, dot: string) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="${size}" height="${size}" align="center" valign="middle" style="width:${size}px;height:${size}px;background:${tile};border-radius:${Math.round(size / 3.6)}px;font:800 ${Math.round(size * 0.52)}px/${size}px ${sans};color:${letter};">G<span style="color:${dot};">.</span></td></tr></table>`;
  const stepRows = steps
    .map(
      (step, i) => `<tr>
<td width="40" valign="top" style="padding:0 0 ${i === steps.length - 1 ? 0 : 14}px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="28" height="28" align="center" valign="middle" style="width:28px;height:28px;background:${color.text1};border-radius:999px;font:700 13px/28px ${sans};color:${color.accent};">${i + 1}</td></tr></table></td>
<td valign="middle" style="padding:0 0 ${i === steps.length - 1 ? 0 : 14}px;font:500 15px/1.45 ${sans};color:${color.text1};">${escapeHtml(step)}</td>
</tr>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>
@media (max-width: 520px) {
  .gs-pad { padding-left: 24px !important; padding-right: 24px !important; }
  .gs-hero { padding: 28px 24px 34px !important; }
  .gs-h1 { font-size: 32px !important; }
  .gs-box { padding: 22px 18px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${color.app};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(layout.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${color.app};">
<tr><td align="center" style="padding:32px 12px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="background:${color.card};border:1px solid ${color.border};border-radius:24px;box-shadow:0 2px 6px rgba(17,17,17,0.06),0 18px 48px rgba(17,17,17,0.10);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="gs-hero" bgcolor="${color.text1}" style="background:${color.text1};background-image:radial-gradient(circle at 100% 0%,rgba(190,242,100,0.28) 0%,rgba(190,242,100,0) 55%);border-radius:24px 24px 0 0;padding:32px 44px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" width="46">${mark(36, color.accent, color.text1, color.text1)}</td>
<td valign="middle" style="font:700 17px/1 ${sans};color:${color.inverse};letter-spacing:-0.3px;">Geez Squad</td>
<td valign="middle" align="right"><span style="display:inline-block;padding:7px 12px;border:1px solid rgba(190,242,100,0.45);border-radius:999px;font:700 10px/1 ${sans};letter-spacing:1.4px;text-transform:uppercase;color:${color.accent};">${escapeHtml(layout.eyebrow)}</span></td>
</tr></table>
<h1 class="gs-h1" style="margin:40px 0 0;font:400 40px/1.1 ${serif};color:${color.inverse};letter-spacing:-0.6px;">${escapeHtml(layout.heading)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr><td width="56" height="4" style="width:56px;height:4px;line-height:4px;font-size:0;background:${color.accent};border-radius:999px;">&nbsp;</td></tr></table>
</td></tr>
<tr><td class="gs-pad" style="padding:36px 44px 0;">
${p(layout.greeting, '0 0 14px')}
${layout.paragraphs.map((body, i) => p(body, i === layout.paragraphs.length - 1 ? '0' : '0 0 14px')).join('\n')}
</td></tr>
${
  steps.length
    ? `<tr><td class="gs-pad" style="padding:26px 44px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:20px 22px;background:${color.subtle};border-radius:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${stepRows}</table>
</td></tr></table>
</td></tr>`
    : ''
}
<tr><td class="gs-pad" style="padding:30px 44px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="gs-box" style="padding:26px;background:${color.accentSoft};border:1px solid ${color.accentEdge};border-radius:20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${color.accent}" style="background:${color.accent};border:1px solid ${color.accentEdge};border-radius:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.65),0 8px 20px rgba(63,98,18,0.25);">
<a href="${url}" target="_blank" rel="noopener" style="display:block;padding:19px 24px;font:800 17px/1.2 ${sans};color:${color.onAccent};text-decoration:none;letter-spacing:-0.2px;border-radius:14px;">${escapeHtml(layout.action.label)}&nbsp;&rarr;</a>
</td></tr></table>
<p style="margin:16px 0 0;text-align:center;font:500 13px/1.55 ${sans};color:${color.success};">${escapeHtml(layout.note)}</p>
</td></tr></table>
</td></tr>
<tr><td style="border-top:1px solid ${color.border};padding:18px 44px;border-radius:0 0 24px 24px;" class="gs-pad">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" width="32">${mark(22, color.text1, color.inverse, color.accent)}</td>
<td valign="middle" style="font:700 11px/1 ${sans};letter-spacing:1.4px;text-transform:uppercase;color:${color.text2};">Stronger, together.</td>
</tr></table>
</td></tr>
</table>
</td></tr>
<tr><td align="center" style="padding:22px 28px 0;font:400 12px/1.6 ${sans};color:${color.text3};">${escapeHtml(layout.reason)}</td></tr>
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

/** Sent to the owner when someone signs up with an email that already has an account. */
export function existingAccountEmail({
  name,
  url,
}: {
  name?: string | null;
  url: string;
}): RenderedEmail {
  return renderEmail({
    subject: 'You already have a Geez Squad account',
    preheader: 'Someone tried to create a new account with this email.',
    eyebrow: 'Account exists',
    heading: 'You’re already one of us.',
    greeting: greet(name),
    paragraphs: [
      'Someone just tried to create a new Geez Squad account with this email address. You already have an account, so no new one was made.',
      'If that was you, sign in with your existing password. Forgot it? Choose “Forgot password” on the sign-in page.',
    ],
    action: { label: 'Sign in to Geez Squad', url },
    note: 'If this wasn’t you, you can safely ignore this email. Nothing on your account has changed.',
    reason:
      'You’re receiving this because this address was used to sign up for Geez Squad and already has an account.',
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
      `${studioName} has set up your studio membership on Geez Squad. Your membership and history stay saved, even if you connect later.`,
    ],
    steps: [
      'Sign up or sign in with this email',
      'Verify your mailbox',
      'Accept the studio request in the app',
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
    paragraphs: [`You’ve been invited to coach at ${studioName} on Geez Squad.`],
    steps: [
      'Sign up or sign in with this email',
      'Verify your mailbox',
      'Accept the coach request in the app',
    ],
    action: { label: 'Accept in Geez Squad', url },
    note: `This request expires in ${duration(expiresInDays * 1440)}. If you weren’t expecting it, you can ignore this email.`,
    reason: `You’re receiving this because ${studioName} invited this address to its coaching team.`,
  });
}
