import { expect, type Page, test } from '@playwright/test';

const BASE_URL = () => process.env.MIO_TEST_BASE_URL ?? 'http://127.0.0.1:0';

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function gotoRoute(page: Page, route: string) {
  await page.goto(`${BASE_URL()}/?e2e=${Date.now()}#${route}`, { waitUntil: 'networkidle' });
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
}

test.describe.serial('Mio web UI', () => {
  test('starts at console and supports primary route navigation', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoRoute(page, '/console');

    await expect(page.getByRole('heading', { name: 'Mio 控制台' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Chat' }).click();
    await expect(page.getByLabel('输入消息')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Persona' }).click();
    await expect(page.getByRole('heading', { name: /人格|Persona|工作室/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('chat composer enables send only when there is input', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoRoute(page, '/chat');

    const input = page.getByLabel('输入消息');
    const send = page.getByRole('button', { name: '发送消息' });

    await expect(input).toBeVisible();
    await expect(send).toBeDisabled();

    await input.fill('E2E draft only');
    await expect(send).toBeEnabled();
    await expectNoHorizontalOverflow(page);

    await input.fill('');
    await expect(send).toBeDisabled();
  });

  test('onboarding first steps progress without client errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.setViewportSize(MOBILE);
    await gotoRoute(page, '/onboarding');

    await expect(page.getByText('步骤 1 / 7')).toBeVisible();
    await page.getByRole('button', { name: '你好' }).click();

    await expect(page.getByText('步骤 2 / 7')).toBeVisible();
    await expect(page.getByRole('button', { name: '继续' })).toBeDisabled();
    await page.locator('.onboarding-input').fill('E2E User');
    await expect(page.getByRole('button', { name: '继续' })).toBeEnabled();
    await page.getByRole('button', { name: '继续' }).click();

    await expect(page.getByText('步骤 3 / 7')).toBeVisible();
    await page.getByRole('radio', { name: '她' }).click();
    await expect(page.getByRole('button', { name: '继续' })).toBeEnabled();
    await page.getByRole('button', { name: '继续' }).click();

    await expect(page.getByText('步骤 4 / 7')).toBeVisible();
    await expect(page.getByRole('button', { name: '温柔' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(pageErrors).toEqual([]);
  });

  test('analytics loads observation panels', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoRoute(page, '/analytics');

    await expect(page.getByRole('heading', { name: '数据与观察' })).toBeVisible();
    await expect(page.locator('.ana-sync-pill')).toContainText(/已读取|不可用/);
    await expect(page.locator('.analytics-view .card')).toHaveCount(5);
    await expectNoHorizontalOverflow(page);
  });

  test('settings exposes key controls', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await gotoRoute(page, '/settings');

    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
    await expect(page.getByRole('radio', { name: '她' })).toBeVisible();
    await expect(page.getByRole('radio', { name: '他' })).toBeVisible();

    const proactiveToggle = page.locator('input[name="proactive-enabled"]');
    const intervalSelect = page.locator('select[name="proactive-interval"]');
    await expect(proactiveToggle).toBeVisible();
    await expect(intervalSelect).toBeVisible();
    await expect(intervalSelect.locator('option')).toHaveCount(4);
    await expect(intervalSelect).toHaveValue(/^(120|360|720|1440)$/);
    await expectNoHorizontalOverflow(page);
  });

  test('auth surface can render independently', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`${BASE_URL()}/?e2e=auth-surface`, { waitUntil: 'networkidle' });

    await page.evaluate(async () => {
      const mod = await import('/js/views/auth.js?e2e=1');
      document.body.innerHTML = '<div id="app-root"></div>';
      document.getElementById('app-root')?.appendChild(mod.renderAuth());
    });

    await expect(page.getByRole('heading', { name: 'Mio 控制台' })).toBeVisible();
    await expect(page.getByLabel('访问令牌')).toBeVisible();
    await page.getByRole('button', { name: '服务器地址' }).click();
    await expect(page.getByLabel('服务器地址')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
