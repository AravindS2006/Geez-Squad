import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext();
const page = await context.newPage();
const report = [];
async function scan(path) {
  const results = await new AxeBuilder({ page })
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
]) {
  await page.goto(`http://localhost:3000${path}`);
  await page.waitForLoadState('networkidle');
  await scan(path);
}
for (const [path, button] of [
  ['/demo?view=plans', 'Create plan'],
  ['/demo?view=members', 'Add member'],
  ['/demo?view=sessions', 'Schedule session'],
]) {
  await page.goto(`http://localhost:3000${path}`);
  await page.getByRole('button', { name: button, exact: true }).first().click();
  await page.getByRole('dialog').waitFor();
  await scan(`${path} + ${button} dialog`);
}
await page.goto('http://localhost:3000/demo?view=coaching');
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
await page.goto('http://localhost:3000/demo?view=practice');
await page.getByRole('button', { name: 'Workout settings' }).click();
await scan('/demo mobile + workout settings');
await page.getByRole('button', { name: 'Close dialog' }).click();
await page.goto('http://localhost:3000/demo');
await scan('/demo mobile');
await page.getByRole('button', { name: 'Open navigation' }).click();
await scan('/demo mobile + navigation');
await writeFile('docs/accessibility-report.json', JSON.stringify(report, null, 2));
await browser.close();
if (report.some((r) => r.violations.length)) process.exitCode = 1;
