import { expect, test } from '@playwright/test';
import sample from '../../src/content/data/scan-sample.json' with { type: 'json' };

test('the sample photo runs through the real model in the browser', async ({ page }) => {
  test.setTimeout(180_000);
  // Force WebAssembly: CI machines have no GPU.
  await page.goto('/?ort=wasm#scan');
  await page.getByRole('button', { name: 'Run on the sample' }).click();
  const stage = page.locator('[data-stage]');
  await expect(stage).toHaveAttribute('data-result', /detections/, { timeout: 170_000 });
  const result = JSON.parse((await stage.getAttribute('data-result'))!);
  // Same count as Python Ultralytics on this file (src/content/data/scan-sample.json).
  expect(result.detections).toHaveLength(44);
  expect(result.backend).toBe('wasm');
  await expect(page.locator('[data-status]')).toContainText('Found 44 text regions');
  await expect(page.locator('[data-overlay] rect.hit')).toHaveCount(44);
});

test('the small-text explainer does the arithmetic', async ({ page }) => {
  await page.goto('/#research');
  await expect(page.locator('[data-readout]')).toContainText('8.0 px');
  await page.locator('[data-up]').check();
  await expect(page.locator('[data-readout]')).toContainText('12.0 px');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('shows the precomputed result instead of a dead control', async ({ page }) => {
    await page.goto('/');
    // Precomputed full OCR (space/server.py) for the sample: boxes plus text lines.
    await expect(page.locator('[data-overlay] rect.hit')).toHaveCount(sample.words.length);
    await expect(page.locator('[data-lines] li')).toHaveCount(sample.lines.length);
    await expect(page.locator('[data-controls]')).toBeHidden();
    await expect(page.locator('[data-status]')).toContainText('Turn on JavaScript');
  });
});
