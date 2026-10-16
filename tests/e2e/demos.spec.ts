import { expect, test, type Page } from '@playwright/test';

async function openDemo(page: Page, card: string, demo: string) {
  await page.goto(`/#${card}`);
  await page.locator(`#${card} > details > summary`).click();
  const box = page.locator(`details[data-demo="${demo}"]`);
  await box.locator('> summary').click();
  await expect(box.locator('[data-demo-root][data-ready="true"]')).toBeAttached();
  return box;
}

test.describe('incident replay', () => {
  const runs = [
    { slug: 'happy-path-rollback', steps: 17, must: 'Self-approval attempt: HTTP 403' },
    { slug: 'viewer-injection-denied', steps: 9, must: 'Policy: Deny' },
    { slug: 'approval-rejected', steps: 12, must: 'admin rejects' },
  ];

  for (const run of runs) {
    test(`steps forward and back through ${run.slug}`, async ({ page }) => {
      const box = await openDemo(page, 'opspilot', 'opspilot-replay');
      await box.locator('select[data-trace]').selectOption(run.slug);
      await expect(box.locator('.replay')).toHaveAttribute('data-trace', run.slug);
      const pos = box.locator('[data-pos]');
      const next = box.getByRole('button', { name: 'Next →' });
      const prev = box.getByRole('button', { name: '← Previous' });
      await expect(pos).toHaveText(`Step 1 of ${run.steps}`);
      await expect(prev).toBeDisabled();
      let seen = false;
      for (let i = 2; i <= run.steps; i++) {
        await next.click();
        await expect(pos).toHaveText(`Step ${i} of ${run.steps}`);
        if ((await box.locator('[data-slot] .step-title').textContent())?.includes(run.must)) seen = true;
      }
      expect(seen).toBe(true);
      await expect(next).toBeDisabled();
      await expect(box.locator('[data-slot] .step-title')).toContainText('Run completed');
      for (let i = run.steps - 1; i >= 1; i--) {
        await prev.click();
        await expect(pos).toHaveText(`Step ${i} of ${run.steps}`);
      }
      await expect(box.locator('[data-slot] .step-title')).toHaveText('Request');
      // Every step names the rows it came from, and the raw rows are one tap away.
      await expect(box.locator('[data-slot] .step-refs')).toContainText('agent_events #');
      await expect(box.locator('[data-slot] details.raw')).toHaveCount(1);
    });
  }

  test('arrow keys move between steps', async ({ page }) => {
    const box = await openDemo(page, 'opspilot', 'opspilot-replay');
    await box.getByRole('button', { name: 'Next →' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(box.locator('[data-pos]')).toHaveText('Step 3 of 17');
    await page.keyboard.press('ArrowLeft');
    await expect(box.locator('[data-pos]')).toHaveText('Step 2 of 17');
  });

  test('loads its code only when opened and reports open / used / close', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));
    await page.goto('/');
    await page.evaluate(() => {
      (window as any).__demo = [];
      window.addEventListener('demo', (e) => (window as any).__demo.push((e as CustomEvent).detail));
    });
    expect(requested.some((u) => /\/(replay|trace-)[^/]*\.js/.test(u))).toBe(false);
    await page.locator('#opspilot > details > summary').click();
    const box = page.locator('details[data-demo="opspilot-replay"]');
    await box.locator('> summary').click();
    await expect(box.locator('[data-demo-root][data-ready="true"]')).toBeAttached();
    expect(requested.some((u) => /\/replay\.[^/]*\.js/.test(u))).toBe(true);
    await box.getByRole('button', { name: 'Next →' }).click();
    await box.getByRole('button', { name: 'Next →' }).click();
    await box.locator('> summary').click();
    // 'toggle' fires asynchronously, so poll for the close event.
    await expect.poll(() => page.evaluate(() => (window as any).__demo)).toEqual([
      { id: 'opspilot-replay', item: 'opspilot', action: 'open' },
      { id: 'opspilot-replay', item: 'opspilot', action: 'used' },
      { id: 'opspilot-replay', item: 'opspilot', action: 'close' },
    ]);
  });
});

test.describe('policy playground', () => {
  const cases = [
    { role: 'viewer', env: 'production', outcome: 'deny', text: 'Denied' },
    { role: 'operator', env: 'production', outcome: 'require_approval', text: 'Needs approval' },
    { role: 'operator', env: 'staging', outcome: 'allow', text: 'Allowed' },
  ];
  for (const c of cases) {
    test(`${c.role} + restart_service + ${c.env} → ${c.outcome}`, async ({ page }) => {
      const box = await openDemo(page, 'opspilot', 'opspilot-policy');
      // Click the visible label (not a forced click), so Playwright waits until
      // nothing such as the fixed mini-bar covers it.
      await box.locator('.seg label').filter({ has: page.locator(`input[name="role"][value="${c.role}"]`) }).click();
      await box.locator('select[name="action"]').selectOption('restart_service');
      await box.locator('.seg label').filter({ has: page.locator(`input[name="env"][value="${c.env}"]`) }).click();
      await expect(box.locator(`input[name="env"][value="${c.env}"]`)).toBeChecked();
      const d = box.locator('[data-decision] .decision');
      await expect(d).toHaveAttribute('data-outcome', c.outcome);
      await expect(d.locator('.decision-outcome')).toHaveText(c.text);
      await expect(d.locator('.decision-outcome svg.icon')).toHaveCount(1);
      await expect(d.locator('.decision-reason')).toHaveText(
        `${c.role} policy evaluated restart_service in ${c.env} as HIGH risk.`,
      );
    });
  }
});

test.describe('follow the packet', () => {
  test('a known cell ends in a pin and the response JSON', async ({ page }) => {
    const box = await openDemo(page, 'cellular', 'cellular-packet');
    await box.locator('select[data-cell]').selectOption('delhi');
    await expect(box.locator('[data-slot] .code')).toContainText('mcc = 404, mnc = 10, tac = 310, cid = 27942');
    await expect(box.locator('[data-pin]')).toHaveCount(0);
    const next = box.getByRole('button', { name: 'Next hop →' });
    await next.click();
    await expect(box.locator('[data-slot] .code')).toContainText('POST /locate');
    await expect(box.locator('[data-slot] .code')).toContainText('{"mcc":404,"mnc":10,"tac":310,"cid":27942}');
    await next.click();
    await next.click();
    await expect(box.locator('[data-slot] .code')).toContainText('SELECT lat, lon');
    await next.click();
    await expect(box.locator('[data-slot] .code')).toHaveText('{"lat":28.601303,"lon":77.236404,"radius":1000}');
    await next.click();
    await expect(box.locator('[data-pin]')).toHaveCount(1);
    await expect(box.locator('.inset .radius')).toHaveCount(1);
    await expect(next).toBeDisabled();
  });

  test('an unknown cell returns tower_not_found and draws nothing', async ({ page }) => {
    const box = await openDemo(page, 'cellular', 'cellular-packet');
    await box.locator('select[data-cell]').selectOption('unknown');
    const next = box.getByRole('button', { name: 'Next hop →' });
    for (let i = 0; i < 4; i++) await next.click();
    await expect(box.locator('[data-slot] .code')).toHaveText('{"error":"tower_not_found"}');
    await next.click();
    await expect(box.locator('[data-slot] .step-title')).toContainText('Nothing is drawn');
    await expect(box.locator('[data-pin]')).toHaveCount(0);
  });

  test('the tower data is attributed', async ({ page }) => {
    await page.goto('/#cellular');
    await page.locator('#cellular > details > summary').click();
    await expect(page.locator('#cellular .attribution')).toContainText(
      'Tower data: OpenCellID, CC BY-SA 4.0, via a Kaggle sample',
    );
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('every demo has readable static content', async ({ page }) => {
    await page.goto('/');
    await page.locator('#opspilot > details > summary').click();
    await expect(page.locator('#opspilot figure.arch svg')).toBeVisible();

    const replay = page.locator('details[data-demo="opspilot-replay"]');
    await replay.locator('> summary').click();
    await expect(replay.locator('.replay-all > li')).toHaveCount(17);
    await expect(replay).toContainText('Self-approval attempt: HTTP 403');
    await expect(replay).toContainText('Real run exported from OpsPilot on 2026-10-16');

    const policy = page.locator('details[data-demo="opspilot-policy"]');
    await policy.locator('> summary').click();
    await expect(policy.locator('table.matrix')).toHaveCount(2);
    await expect(policy.locator('.action-risks li')).toHaveCount(7);

    await page.locator('#cellular > details > summary').click();
    const packet = page.locator('details[data-demo="cellular-packet"]');
    await packet.locator('> summary').click();
    await expect(packet.locator('.hop')).toHaveCount(6);
    await expect(packet.locator('[data-pin]')).toHaveCount(1);
    await expect(packet).toContainText('{"lat":20.913162231445,"lon":70.380477905273,"radius":1000}');
  });
});
