import { expect, test, type Page } from '@playwright/test';

// Test hook: ?brain-test=1 shortens every brain timer by 10× (idle after 3 s,
// suggestions expire after 2 s, ...) and exposes window.__brain.
const TEST = '/?brain-test=1';

const projectOrder = (page: Page) =>
  page.locator('#projects > article.card[data-item]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.item));

test('the mini-bar has exactly four items, the fourth opens the brain panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav.minibar li')).toHaveCount(4);
  const brain = page.locator('nav.minibar a[data-brain-open]');
  await expect(brain).toHaveText('Brain');
  await brain.click();
  const panel = page.locator('dialog[data-brain-panel]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('svg[data-brain-radar]')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Reset what this site learned' })).toBeVisible();
  await expect(panel).toContainText('Everything stays on this device');
  await expect(panel.locator('a[href="/privacy/"]')).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
  // Escape closes it too.
  await brain.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('opener chip reorders only below-the-fold cards and never moves what is on screen', async ({ page }) => {
  await page.goto(TEST); // seeded sampling, so the order is repeatable
  const opener = page.locator('[data-opener]');
  await expect(opener).toBeVisible();
  await opener.scrollIntoViewIfNeeded();
  expect(await projectOrder(page)).toEqual(['opspilot', 'semantic-hire', 'cellular', 'smoketrail']);

  const snapshot = () =>
    page.evaluate(() => ({
      y: window.scrollY,
      h1: document.querySelector('h1')!.getBoundingClientRect().top,
      opener: document.querySelector('[data-opener]')!.getBoundingClientRect().toJSON(),
      about: document.getElementById('about')!.getBoundingClientRect().top,
      projectsTop: document.getElementById('projects')!.getBoundingClientRect().top,
      vh: window.innerHeight,
    }));
  const before = await snapshot();
  expect(before.projectsTop).toBeGreaterThan(before.vh); // projects start below the fold

  await page.getByRole('button', { name: 'Hiring for ML' }).click();
  await expect(page.locator('.opener-done')).toContainText('Hiring for ML');
  await page.waitForTimeout(400); // FLIP settle

  const after = await snapshot();
  expect(after.y).toBe(before.y);
  expect(after.h1).toBe(before.h1);
  expect(after.opener.top).toBe(before.opener.top);
  expect(after.opener.height).toBe(before.opener.height);
  expect(after.about).toBe(before.about);
  const order = await projectOrder(page);
  expect(order[0]).toBe('semantic-hire');
  expect([...order].sort()).toEqual(['cellular', 'opspilot', 'semantic-hire', 'smoketrail']); // nothing hidden

  // The panel explains the change.
  await page.locator('nav.minibar a[data-brain-open]').click();
  await expect(page.locator('[data-brain-decisions]')).toContainText('Moved semantic-hire up because you picked "Hiring for ML".');

  // The choice is remembered: the opener line stays away on the next visit.
  await page.reload();
  await expect(page.locator('[data-opener]')).toBeHidden();
});

test('cards already on screen are never reordered', async ({ page }) => {
  await page.goto('/');
  await page.locator('#projects-h').evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const visible = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#projects > article.card')]
      .filter((c) => c.getBoundingClientRect().top < window.innerHeight)
      .map((c) => ({ id: c.dataset.item, top: c.getBoundingClientRect().top })),
  );
  expect(visible.length).toBeGreaterThan(0);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('ask', { detail: { query: 'data pipelines', results: ['smoketrail', 'cellular'] } })),
  );
  await page.waitForTimeout(1200);
  for (const v of visible) {
    const top = await page.locator(`#${v.id}`).evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBe(v.top);
  }
});

test('reset clears everything the site stored', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Software' }).click();
  const keys = () =>
    page.evaluate(() => ({
      local: Object.keys(localStorage).filter((k) => k.startsWith('brain')),
      session: Object.keys(sessionStorage).filter((k) => k.startsWith('brain')),
    }));
  expect((await keys()).local).toEqual(expect.arrayContaining(['brain:v1', 'brain:opener-done']));
  await page.locator('nav.minibar a[data-brain-open]').click();
  await page.getByRole('button', { name: 'Reset what this site learned' }).click();
  await expect(page.locator('[data-brain-reset-note]')).toContainText('forgotten everything');
  await expect(page.locator('[data-brain-decisions]')).toContainText('None yet.');
  expect(await keys()).toEqual({ local: [], session: [] });
});

test('an idle visitor gets no suggestion', async ({ page }) => {
  await page.goto(TEST);
  // Give the brain something to go on, then walk away.
  await page.getByRole('button', { name: 'Software' }).click();
  await page.evaluate(() => {
    for (const id of ['opspilot', 'cellular']) {
      (window as any).__brain.signal({ kind: 'expand', itemId: id });
    }
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(8000); // idle after 3 s in test mode
  expect(await page.evaluate(() => (window as any).__brain.isIdle())).toBe(true);
  await expect(page.locator('[data-suggest-slot] .chip:not([hidden])')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__brain.pacer.state.shown)).toBe(0);
});

test('finishing a card earns one calm suggestion that never moves the page', async ({ page }) => {
  await page.goto(TEST);
  const card = page.locator('#cellular');
  await card.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await card.locator('summary').click();
  await page.waitForTimeout(2500); // ≥ 10 s of reading in test time
  const slot = page.locator('[data-suggest-slot="projects"]');
  const slotBox = await slot.boundingBox();
  await card.locator('summary').click(); // collapse: a natural pause
  const chip = slot.locator('.chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Liked Cellular system? → OpsPilot');
  await expect(page.locator('[data-brain-live]')).toContainText('Suggestion:');
  // The slot's space was reserved: showing and dismissing changes no layout.
  const box = await slot.boundingBox();
  expect(box!.height).toBe(slotBox!.height);
  await chip.getByRole('button', { name: 'Dismiss suggestion' }).click();
  await expect(chip).toBeHidden();
  expect((await slot.boundingBox())!.height).toBe(slotBox!.height);
  await page.locator('nav.minibar a[data-brain-open]').click();
  await expect(page.locator('[data-brain-decisions]')).toContainText('You dismissed OpsPilot');
});

test('no stray brain controls without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('[data-opener]')).toBeHidden();
  await expect(page.locator('[data-suggest-slot] .chip')).toHaveCount(2);
  await expect(page.locator('[data-suggest-slot] .chip').first()).toBeHidden();
  await expect(page.locator('nav.minibar a[data-brain-open]')).toHaveAttribute('href', '/privacy/');
  await context.close();
});
