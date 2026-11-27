import { provisionTestAdmin } from './support/admin';
import { grantStudioTerm } from './support/membership';
import { addPoseFixture } from './support/pose-fixture';
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

process.loadEnvFile('.env');

type Box = { x: number; y: number; width: number; height: number };
const box = async (locator: Locator) => (await locator.boundingBox()) as Box;
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

async function openDemoRoom(page: Page) {
  await page.goto('/demo?view=sessions');
  await page.getByRole('button', { name: 'Open studio', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Class video gallery' })).toBeVisible();
}

async function noDocumentScroll(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
}

test('coach panel docks, resizes, floats and docks again without remounting the gallery', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemoRoom(page);
  const fixture = randomUUID();
  const firstFeed = page.locator('.participant-feed').first();
  await firstFeed.evaluate((node, id) => node.setAttribute('data-layout-fixture', id), fixture);

  // Docked: the stage shrinks beside the panel; nothing covers it and there is no backdrop.
  const opener = page.getByRole('button', { name: 'Coach tools', exact: true });
  await opener.click();
  const panel = page.getByRole('complementary', { name: 'Coach tools panel' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-presentation', 'docked');
  await expect(opener).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('tab', { name: 'Coach tools' })).toBeFocused();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const stage = await box(page.locator('.meeting-stage'));
  let panelBox = await box(panel);
  expect(stage.x + stage.width).toBeLessThanOrEqual(panelBox.x + 1);
  await expect(page.getByRole('button', { name: /^Focus /, exact: false }).first()).toBeEnabled();

  // The separator resizes with the keyboard and reports its value.
  const separator = page.getByRole('separator', { name: 'Resize panel' });
  const start = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', String(start + 32));
  await page.keyboard.press('End');
  const max = Number(await separator.getAttribute('aria-valuemax'));
  expect(max).toBeLessThanOrEqual(560);
  await expect(separator).toHaveAttribute('aria-valuenow', String(max));
  panelBox = await box(panel);
  // The docked panel has 4px + 12px of margin around its column.
  expect(Math.abs(panelBox.width + 16 - max)).toBeLessThanOrEqual(2);
  // Pointer resize: dragging the separator right narrows the panel.
  const sep = await box(separator);
  await page.mouse.move(sep.x + sep.width / 2, sep.y + sep.height / 2);
  await page.mouse.down();
  await page.mouse.move(sep.x + sep.width / 2 + 120, sep.y + sep.height / 2, { steps: 6 });
  await page.mouse.up();
  const dragged = Number(await separator.getAttribute('aria-valuenow'));
  expect(dragged).toBeLessThan(max);
  expect(dragged).toBeGreaterThanOrEqual(300);

  // Tabs follow the arrow keys.
  await page.getByRole('tab', { name: 'Coach tools' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /^Chat/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary', { name: 'Chat panel' })).toBeVisible();

  // Floating: inside the room, movable and resizable by keyboard, then docked again.
  await page.getByRole('button', { name: 'Undock panel' }).click();
  const floating = page.locator('#room-panel');
  await expect(floating).toHaveAttribute('data-presentation', 'floating');
  const room = await box(page.locator('.meeting-shell'));
  let rect = await box(floating);
  expect(inside(rect, room)).toBe(true);
  await page.getByRole('button', { name: 'Move panel' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await box(floating)).x).toBeCloseTo(rect.x - 16, 0);
  rect = await box(floating);
  await page.getByRole('button', { name: 'Resize panel' }).focus();
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await box(floating)).height).toBeCloseTo(rect.height - 64, 0);
  // Pointer move by the title bar, clamped to the room.
  const title = await box(floating.locator('h2'));
  await page.mouse.move(title.x + 10, title.y + 10);
  await page.mouse.down();
  await page.mouse.move(title.x - 4000, title.y + 4000, { steps: 8 });
  await page.mouse.up();
  rect = await box(floating);
  expect(inside(rect, room)).toBe(true);
  expect(Math.round(rect.x - room.x)).toBe(8);
  const a11y = await new AxeBuilder({ page })
    .include('#room-panel')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(a11y.violations.map((v) => v.id)).toEqual([]);

  // The layout survives a reload.
  await page.reload();
  await expect(page.getByRole('group', { name: 'Class video gallery' })).toBeVisible();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('#room-panel')).toHaveAttribute('data-presentation', 'floating');
  await page.getByRole('button', { name: 'Dock panel' }).click();
  await expect(page.locator('#room-panel')).toHaveAttribute('data-presentation', 'docked');
  await expect(page.getByRole('separator', { name: 'Resize panel' })).toHaveAttribute(
    'aria-valuenow',
    String(dragged),
  );

  // Escape closes and returns focus to the button that opened the panel.
  await page.getByRole('tab', { name: /^Chat/ }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#room-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test('the coach gallery keeps its feeds while the panel opens, docks and floats', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemoRoom(page);
  const fixture = randomUUID();
  const feeds = page.locator('.participant-feed');
  const count = await feeds.count();
  await feeds.evaluateAll(
    (nodes, id) => nodes.forEach((n) => n.setAttribute('data-layout-fixture', id)),
    fixture,
  );
  await page.getByRole('button', { name: 'Coach tools', exact: true }).click();
  await page.getByRole('button', { name: 'Undock panel' }).click();
  await page.getByRole('button', { name: 'Dock panel' }).click();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(page.locator(`.participant-feed[data-layout-fixture="${fixture}"]`)).toHaveCount(
    count,
  );

  // My preview: drag to a corner, or move it with its button.
  await page.getByRole('button', { name: 'My preview', exact: true }).click();
  const preview = page.getByRole('group', { name: 'My preview' });
  await expect(preview).toHaveAttribute('data-corner', 'top-right');
  const monitor = await box(page.locator('.coach-monitor'));
  const tile = await box(preview);
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height - 12);
  await page.mouse.down();
  await page.mouse.move(monitor.x + 60, monitor.y + monitor.height - 40, { steps: 8 });
  await page.mouse.up();
  await expect(preview).toHaveAttribute('data-corner', 'bottom-left');
  expect(inside(await box(preview), monitor)).toBe(true);
  await page.getByRole('button', { name: /^Move my preview/ }).click();
  await expect(preview).toHaveAttribute('data-corner', 'bottom-right');
});

for (const viewport of [
  { width: 1440, height: 900, presentation: 'docked' },
  { width: 1280, height: 720, presentation: 'docked' },
  { width: 390, height: 844, presentation: 'sheet' },
  { width: 320, height: 568, presentation: 'sheet' },
  { width: 844, height: 390, presentation: 'side-sheet' },
  { width: 768, height: 1024, presentation: 'side-sheet' },
  { width: 1024, height: 768, presentation: 'docked' },
]) {
  test(`panel at ${viewport.width}x${viewport.height} is a ${viewport.presentation} with reachable controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openDemoRoom(page);
    // Layout stress fixture: the sample room has no video service, so add the widest
    // action a live room shows (Join live video) to prove the zones still fit. It does
    // not claim a real LiveKit connection.
    await page.locator('.meeting-class-buttons').evaluate((group) => {
      const join = document.createElement('button');
      join.className = 'button lime meeting-join';
      join.setAttribute('aria-label', 'Join live video');
      join.innerHTML =
        '<span class="meeting-full-label">Join live video</span><span class="meeting-mobile-label" aria-hidden="true">Join</span>';
      group.append(join);
    });
    for (const opener of ['Chat', 'Coach tools', 'More options']) {
      await page.getByRole('button', { name: opener, exact: true }).click();
      const panel = page.locator('#room-panel');
      await expect(panel).toHaveAttribute('data-presentation', viewport.presentation);
      const p = await box(panel);
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x + p.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(p.y + p.height).toBeLessThanOrEqual(viewport.height + 1);
      if (viewport.presentation === 'sheet') {
        expect(Math.round(p.width)).toBe(viewport.width);
        expect(Math.round(p.y + p.height)).toBe(viewport.height);
        await expect(page.getByRole('button', { name: 'Undock panel' })).toHaveCount(0);
      }
      if (viewport.presentation === 'side-sheet') {
        expect(Math.round(p.x + p.width)).toBe(viewport.width);
        await expect(page.getByRole('button', { name: 'Undock panel' })).toHaveCount(0);
      }
      for (const control of await panel.locator('[role="tab"], [aria-label="Close panel"]').all()) {
        const b = await box(control);
        expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
      }
      await noDocumentScroll(page);
      await page.getByRole('button', { name: 'Close panel' }).click();
      await expect(panel).toHaveCount(0);
      await expect(page.getByRole('button', { name: opener, exact: true })).toBeFocused();
    }
    // The dock stays on screen with 44px targets whatever the width.
    for (const button of await page.locator('.meeting-dock button').all()) {
      if (!(await button.isVisible())) continue;
      const b = await box(button);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
      expect(b.y + b.height).toBeLessThanOrEqual(viewport.height);
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    }
    // Dock zones never overlap each other.
    const zones = await page
      .locator('.meeting-dock [role="group"], .meeting-session-buttons')
      .all();
    const boxes: Box[] = [];
    for (const zone of zones) if (await zone.isVisible()) boxes.push(await box(zone));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        const apart =
          a.x + a.width <= b.x + 1 ||
          b.x + b.width <= a.x + 1 ||
          a.y + a.height <= b.y + 1 ||
          b.y + b.height <= a.y + 1;
        expect(apart, `dock zones ${i} and ${j} overlap`).toBe(true);
      }
  });
}

test('a trainee drags the floating coach video between corners without remounting the camera', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const id = randomUUID();
  const coachEmail = `panel-coach-${id}@example.test`;
  const traineeEmail = `panel-trainee-${id}@example.test`;
  const address = () =>
    `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;
  const coach = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': address() } });
  await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': address() });
  const db = new PrismaClient();
  const origin = 'http://localhost:3000';
  const headers = { Origin: origin };
  try {
    for (const [request, name, email, admin] of [
      [coach.request, 'Panel Coach', coachEmail, true],
      [page.request, 'Panel Trainee', traineeEmail, false],
    ] as const) {
      expect(
        (
          await request.post(`${origin}/api/auth/sign-up/email`, {
            headers,
            data: { name, email, password: 'Local-Integration-Only-12345' },
          })
        ).ok(),
      ).toBe(true);
      if (admin) await provisionTestAdmin(db, email);
      expect(
        (
          await request.post(`${origin}/api/command`, {
            headers,
            data: { action: 'onboard', name, role: 'trainee', adult: true },
          })
        ).ok(),
      ).toBe(true);
    }
    const invite = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: { action: 'invite', email: traineeEmail },
    });
    expect(
      (
        await page.request.post('/api/command', {
          headers,
          data: { action: 'acceptInvite', code: (await invite.json()).code },
        })
      ).ok(),
    ).toBe(true);
    const trainee = await db.user.findUniqueOrThrow({ where: { email: traineeEmail } });
    await grantStudioTerm(db, traineeEmail);
    const created = await coach.request.post(`${origin}/api/command`, {
      headers,
      data: {
        action: 'createClass',
        title: 'Panel drag check',
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        duration: 30,
        capacity: 2,
        participantIds: [trainee.id],
      },
    });
    const session = await created.json();
    expect(
      (
        await coach.request.post(`${origin}/api/command`, {
          headers,
          data: { action: 'classControl', id: session.id, control: 'start' },
        })
      ).ok(),
    ).toBe(true);

    await page.setViewportSize({ width: 1280, height: 800 });
    await addPoseFixture(page);
    await page.goto(`/studio/${session.id}`);
    await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
    await expect(page.getByText('Pose detected', { exact: true })).toBeVisible();
    const fixture = randomUUID();
    const analyzer = page.locator('.camera-analyzer');
    await analyzer.evaluate(
      (node, value) => node.setAttribute('data-layout-fixture', value),
      fixture,
    );
    await page.getByLabel('Coach view').selectOption('small');
    const layout = page.locator('.trainee-video-layout');
    await expect(layout).toHaveAttribute('data-coach-position', 'top-right');

    // A panel docked beside the stage keeps the camera element too.
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.locator('#room-panel')).toHaveAttribute('data-presentation', 'docked');
    await page.getByRole('button', { name: 'Close panel' }).click();

    for (const [target, expected] of [
      ['bottom-left', 'bottom-left'],
      ['top-left', 'top-left'],
      ['bottom-right', 'bottom-right'],
    ] as const) {
      const tile = await box(page.locator('.coach-stage'));
      const area = await box(layout);
      const x = target.endsWith('left') ? area.x + 40 : area.x + area.width - 40;
      const y = target.startsWith('top') ? area.y + 60 : area.y + area.height - 40;
      await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height - 10);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 10 });
      await page.mouse.up();
      await expect(layout).toHaveAttribute('data-coach-position', expected);
      const camera = await box(page.locator('.camera-view'));
      await expect
        .poll(async () => inside(await box(page.locator('.coach-stage')), camera))
        .toBe(true);
      await expect(analyzer).toHaveAttribute('data-layout-fixture', fixture);
    }
    // A short press is still a click: it does not move the tile.
    const before = await layout.getAttribute('data-coach-position');
    const tile = await box(page.locator('#coach-video-feed'));
    await page.mouse.click(tile.x + tile.width / 2, tile.y + tile.height / 2);
    await expect(layout).toHaveAttribute('data-coach-position', before!);
    // The dropped corner is saved like the Options choice.
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('geez-squad:coach-video-layout:v1') || '{}').position,
      ),
    ).toBe('bottom-right');
  } finally {
    const users = await db.user.findMany({
      where: { email: { in: [coachEmail, traineeEmail] } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
    await coach.close();
  }
});
