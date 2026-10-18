import { expect, test } from '@playwright/test';
import data from '../../src/content/data/smoketrail/forecast-2019.json' with { type: 'json' };

test('scrubbing the 2019 season updates the forecast and its SHAP drivers', async ({ page }) => {
  await page.goto('/#smoketrail');
  await page.locator('#smoketrail > details > summary').click();
  const st = page.locator('[data-st]');
  await st.scrollIntoViewIfNeeded();
  await st.locator('input[type=range]').fill('10');
  const d = data.days[10];
  await expect(st.locator('[data-st-f]')).toHaveText(String(Math.round(d.forecast)));
  await expect(st.locator('[data-st-a]')).toHaveText(String(Math.round(d.actual)));
  await expect(st.locator('[data-st-drivers] li')).toHaveCount(3);
  await expect(st.locator('[data-st-drivers] li').first()).toContainText(d.drivers[0].feature);
});

test('the hero haze is labelled with real SmokeTrail data', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-haze-caption]')).toContainText(/Delhi's real air on \d+ \w+ 2019: PM2\.5 \d+ µg\/m³/);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the explorer still shows the chart and the worst-air day', async ({ page }) => {
    await page.goto('/');
    const st = page.locator('[data-st]');
    await expect(st.locator('svg.chart')).toBeAttached();
    await expect(st.locator('[data-st-slider]')).toBeHidden();
    const worst = data.days.reduce((a, b) => (b.actual > a.actual ? b : a));
    await expect(st.locator('[data-st-a]')).toHaveText(String(Math.round(worst.actual)));
  });
});
