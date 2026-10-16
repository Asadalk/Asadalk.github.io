import { expect, test, type Page } from '@playwright/test';
import python from '../parity/semantic-hire/python.json' with { type: 'json' };

// Loading the 45 MB model from the local preview server takes a few seconds.
test.setTimeout(90_000);

/** Fails the test if the page talks to any origin other than its own. */
function sameOriginOnly(page: Page, baseURL: string | undefined) {
  const origin = new URL(baseURL ?? 'http://localhost').origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (!['data:', 'blob:'].includes(u.protocol) && u.origin !== origin) foreign.push(r.url());
  });
  return foreign;
}

test('"Ask about me" finds the research for an object detection question', async ({ page, baseURL }) => {
  const foreign = sameOriginOnly(page, baseURL);
  await page.goto('/');
  const input = page.getByLabel('Ask about me', { exact: true }).and(page.locator('input'));
  await expect(input).toBeVisible();

  const event = page.evaluate(
    () => new Promise<{ query: string; dims: number; ids: string[] }>((resolve) => {
      window.addEventListener('ask', (e) => {
        const d = (e as CustomEvent).detail;
        resolve({ query: d.query, dims: d.vector.length, ids: d.results.map((r: { id: string }) => r.id) });
      }, { once: true });
    }),
  );
  await input.fill('object detection research');
  await input.press('Enter');

  const results = page.locator('[data-ask-results] a');
  await expect(results.first()).toBeVisible({ timeout: 60_000 });
  expect(await results.count()).toBeLessThanOrEqual(5);
  await expect(results.first()).toHaveAttribute('href', '/#research-bstd');
  await expect(page.locator('#research-bstd')).toHaveClass(/ask-hit/);
  await expect(page.locator('#ask-status')).toHaveAttribute('aria-live', 'polite');

  const detail = await event;
  expect(detail).toMatchObject({ query: 'object detection research', dims: 384 });
  expect(detail.ids[0]).toBe('research-bstd');
  expect(foreign).toEqual([]);
});

test('the semantic-hire matcher ranks jobs on the device exactly like the Python service', async ({ page, baseURL }) => {
  const foreign = sameOriginOnly(page, baseURL);
  await page.goto('/#semantic-hire');
  await page.locator('#semantic-hire summary').click();
  const demo = page.locator('[data-sh]');
  await expect(demo).toBeVisible();

  const example = demo.getByRole('button', { name: 'Try an example resume' });
  const items = demo.locator('[data-sh-list] > li');
  const seen: { query_id: string; top5: { job_id?: string; final: number }[] }[] = [];
  // The example button walks through the repo's 8 evaluation queries in order.
  for (const q of python.queries) {
    await example.click();
    await expect(demo.locator('#sh-status')).toContainText('ranked on your device', { timeout: 60_000 });
    await expect(items).toHaveCount(5);
    const rows = await items.evaluateAll((els) =>
      els.map((e) => ({ job_id: (e as HTMLElement).dataset.jobId, final: Number((e as HTMLElement).dataset.final) })),
    );
    seen.push({ query_id: q.query_id, top5: rows });
    expect(rows.map((r) => r.job_id), q.query_id).toEqual(q.top5.map((r) => r.job_id));
    rows.forEach((r, i) => expect(Math.abs(r.final - q.top5[i].final), q.query_id).toBeLessThanOrEqual(0.0005));
  }
  // PARITY_OUT=path records what the real page showed, for the parity report.
  if (process.env.PARITY_OUT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.PARITY_OUT, JSON.stringify({ side: 'page', browser: test.info().project.name, queries: seen }, null, 1) + '\n');
  }
  await expect(items.first().locator('.sh-bar')).toHaveAttribute('aria-label', /from meaning/);
  expect(foreign).toEqual([]);
});

test('no model is fetched before the visitor interacts or the page sits idle', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', (r) => {
    if (/\/models\/|\/ort-embed\//.test(r.url())) modelRequests.push(r.url());
  });
  await page.goto('/');
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);
  expect(modelRequests).toEqual([]);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('there is no search box or matcher, and the page is complete', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#ask-q')).toBeHidden();
    await expect(page.locator('[data-sh]')).toBeHidden();
    await expect(page.locator('#research')).toContainText('0.621');
    await expect(page.locator('#semantic-hire')).toContainText('Precision@5');
  });
});
