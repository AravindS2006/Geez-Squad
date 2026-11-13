import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { browserCookies, createSignedInFixture } from './a11y-signed-in-fixture.mjs';
try {
  process.loadEnvFile('.env');
} catch {
  // The isolated runner passes the environment directly.
}
const base = (process.env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('The accessibility gate runs only against a local test server.');
// Fake media lets the signed-in practice and room cameras start without hardware.
const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const context = await browser.newContext();
const page = await context.newPage();
const report = [];
async function scan(path, target = page) {
  const results = await new AxeBuilder({ page: target })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => ({ target: n.target, html: n.html, summary: n.failureSummary })),
  }));
  report.push({ path, violations });
  console.log(
    path,
    JSON.stringify(
      violations.map((v) => ({
        id: v.id,
        count: v.nodes.length,
        targets: v.nodes.slice(0, 8).map((n) => n.target),
      })),
    ),
  );
}
for (const path of [
  '/',
  '/demo',
  '/demo?view=members',
  '/demo?view=memberships',
  '/demo?view=attendance',
  '/demo?view=payments',
  '/demo?view=enquiries',
  '/demo?view=staff',
  '/demo?view=classes',
  '/demo?view=studio-details',
  '/demo?view=coaching',
  '/demo?view=clients',
  '/demo?view=sessions',
  '/demo?view=plans',
  '/demo?view=analytics',
  '/demo?view=settings',
  '/demo?view=practice',
  '/demo?view=nutrition',
  '/login',
  '/privacy',
  '/terms',
]) {
  await page.goto(`${base}${path}`);
  await page.waitForLoadState('networkidle');
  await scan(path);
}
for (const [path, button] of [
  ['/demo?view=plans', 'Create plan'],
  ['/demo?view=members', 'Add member'],
  ['/demo?view=sessions', 'Schedule session'],
]) {
  await page.goto(`${base}${path}`);
  await page.getByRole('button', { name: button, exact: true }).first().click();
  await page.getByRole('dialog').waitFor();
  await scan(`${path} + ${button} dialog`);
}
await page.goto(`${base}/demo?view=coaching`);
await page
  .getByRole('button', { name: /^(Open studio|Join session)$/ })
  .first()
  .click();
await page.getByText('ILLUSTRATIVE STUDIO PREVIEW', { exact: true }).waitFor();
await scan('/demo + live studio');
await page.getByRole('button', { name: 'Coach tools' }).click();
await scan('/demo + coach tools');
await page.getByLabel('Coaching cue', { exact: true }).fill('Keep this movement controlled.');
await page.getByRole('button', { name: 'Send class cue' }).click();
await page.getByRole('button', { name: 'Close dialog' }).click();
await page.getByRole('button', { name: 'Chat', exact: true }).click();
await page.getByLabel('Session message', { exact: true }).fill('You are doing well.');
await page.getByRole('button', { name: 'Send session message' }).click();
await scan('/demo + populated studio conversation');
await page.getByRole('button', { name: 'Close dialog' }).click();
await page.getByRole('button', { name: 'More options' }).click();
await scan('/demo + meeting options');
await page.getByRole('button', { name: 'Close dialog' }).click();
await page.setViewportSize({ width: 390, height: 844 });
await scan('/demo mobile + live studio');
await page.goto(`${base}/demo?view=practice`);
await page.getByRole('button', { name: 'Workout settings' }).click();
await scan('/demo mobile + workout settings');
await page.getByRole('button', { name: 'Close dialog' }).click();
await page.goto(`${base}/demo`);
await scan('/demo mobile');
await page.getByRole('button', { name: 'Open navigation' }).click();
await scan('/demo mobile + navigation');
await context.close();

// Signed-in routes: disposable owner/admin, coach and trainee on the local test database.
const db = new PrismaClient();
const fixture = await createSignedInFixture(db, base);
async function signedIn(actor) {
  const actorContext = await browser.newContext({
    extraHTTPHeaders: { 'x-forwarded-for': `2001:db8:${randomBytes(2).toString('hex')}::1` },
  });
  await actorContext.addCookies(browserCookies(actor, base));
  return actorContext.newPage();
}
async function scanViews(target, label, views) {
  for (const view of views) {
    await target.goto(`${base}/app?view=${view}`);
    await target.waitForLoadState('networkidle');
    await target.locator('main').first().waitFor();
    await scan(`/app?view=${view} (${label})`, target);
  }
}
/** Start the camera with fake media; scan whatever state it settles in (video or error). */
async function enableCamera(target) {
  await target
    .getByRole('button', { name: /^(Enable camera|Turn on session camera)$/ })
    .first()
    .click();
  await target
    .waitForFunction(
      () =>
        Boolean(document.querySelector('video.camera-video')?.srcObject) ||
        Boolean(document.querySelector('[role="alert"]')),
      undefined,
      { timeout: 20000 },
    )
    .catch(() => console.log('Camera did not report a stream or an error within 20 s.'));
}
async function openLiveClass(target) {
  await target.goto(`${base}/app?view=sessions`);
  await target
    .getByRole('button', { name: /^(Open studio|Join session)$/ })
    .first()
    .click();
}
try {
  const owner = await signedIn(fixture.owner);
  await scanViews(owner, 'owner', [
    'dashboard',
    'members',
    'memberships',
    'attendance',
    'payments',
    'enquiries',
    'staff',
    'classes',
    'studio-details',
    'coaching',
    'clients',
    'sessions',
    'plans',
    'analytics',
    'nutrition',
    'settings',
  ]);
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${base}/app`);
  await owner.getByRole('button', { name: 'Open navigation' }).click();
  await scan('/app mobile + navigation (owner)', owner);

  const coach = await signedIn(fixture.coach);
  await scanViews(coach, 'coach', [
    'coaching',
    'clients',
    'sessions',
    'classes',
    'plans',
    'analytics',
    'nutrition',
    'benefits',
    'settings',
  ]);
  await openLiveClass(coach);
  await coach.getByRole('button', { name: 'Coach tools' }).waitFor();
  await scan('/app coach live room (no LiveKit)', coach);
  await coach.getByRole('button', { name: 'Coach tools' }).click();
  await coach.getByRole('dialog').waitFor();
  await scan('/app coach live room + coach tools', coach);
  await coach.getByRole('button', { name: 'Close dialog' }).click();
  await coach.setViewportSize({ width: 390, height: 844 });
  await scan('/app mobile coach live room', coach);

  const trainee = await signedIn(fixture.trainee);
  await scanViews(trainee, 'trainee', [
    'dashboard',
    'benefits',
    'sessions',
    'plans',
    'analytics',
    'nutrition',
    'settings',
  ]);
  await trainee.goto(`${base}/app?view=practice`);
  await trainee.getByRole('button', { name: 'Enable camera', exact: true }).waitFor();
  await scan('/app?view=practice (trainee, camera off)', trainee);
  await enableCamera(trainee);
  await scan('/app?view=practice (trainee, fake camera)', trainee);
  await openLiveClass(trainee);
  await trainee
    .getByRole('button', { name: /^(Enable camera|Turn on session camera)$/ })
    .first()
    .waitFor();
  await scan('/app trainee live room (no LiveKit)', trainee);
  await enableCamera(trainee);
  await scan('/app trainee live room (fake camera)', trainee);
  await trainee.setViewportSize({ width: 390, height: 844 });
  await scan('/app mobile trainee live room (fake camera)', trainee);
} finally {
  await fixture.cleanup();
  await db.$disconnect();
  await writeFile('docs/accessibility-report.json', JSON.stringify(report, null, 2));
  await browser.close();
}
if (report.some((r) => r.violations.length)) process.exitCode = 1;
