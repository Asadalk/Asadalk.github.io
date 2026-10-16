import { expect, test } from '@playwright/test';

const sections = ['about', 'research', 'projects', 'experience', 'contact'];

test('every signboard is a visible link to its section', async ({ page }) => {
  await page.goto('/');
  for (const id of sections) {
    const sign = page.locator(`svg.scene:visible a.shop[data-target="${id}"]`);
    await expect(sign).toHaveCount(1);
    await expect(sign).toHaveAttribute('href', `#${id}`);
  }
});

test('tapping a signboard locks on and lands on the section', async ({ page }) => {
  await page.goto('/');
  await page.locator('svg.scene:visible a.shop[data-target="projects"]').click();
  await expect(page).toHaveURL(/#projects$/);
  await expect(page.locator('#projects-h')).toBeFocused();
  await expect(page.locator('#projects-h')).toBeInViewport();
  await expect(page.locator('svg.scene:visible')).not.toHaveClass(/locking/);
});

test('reduced motion jumps straight to the section', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('svg.scene:visible a.shop[data-target="contact"]').click();
  await expect(page).toHaveURL(/#contact$/);
  await expect(page.locator('#contact-h')).toBeInViewport();
  // Boxes are fully drawn immediately.
  const offset = await page.locator('svg.scene:visible .box').first().evaluate((el) => getComputedStyle(el).strokeDashoffset);
  expect(parseFloat(offset)).toBe(0);
});

test('keyboard users can reach the signboards', async ({ page }) => {
  await page.goto('/');
  const research = page.locator('svg.scene:visible a.shop[data-target="research"]');
  for (let i = 0; i < 15 && !(await research.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(research).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#research$/);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('signboards still navigate and content is all there', async ({ page }) => {
    await page.goto('/');
    await page.locator('svg.scene:visible a.shop[data-target="experience"]').click();
    await expect(page).toHaveURL(/#experience$/);
    await expect(page.locator('#research')).toContainText('0.621');
    await expect(page.locator('#opspilot')).toBeAttached();
  });

  test('plain résumé renders', async ({ page }) => {
    await page.goto('/resume/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Asadullah Faisal');
    await expect(page.locator('body')).not.toContainText(/\+91|cgpa/i);
  });
});
