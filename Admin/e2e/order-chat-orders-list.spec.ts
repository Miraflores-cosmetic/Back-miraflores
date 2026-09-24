import { expect, test } from '@playwright/test';

/**
 * Order chat — колонка чата в списке заказов.
 * Требует API (:3001) + Admin (:3010) и staff с доступом к orders.
 *
 *   npm run dev:api
 *   npm run dev:admin
 *   cd Admin && npm run test:e2e -- e2e/order-chat-orders-list.spec.ts
 *
 * Env: E2E_MODERATOR_EMAIL, E2E_MODERATOR_PASSWORD (как staff-acl.spec.ts)
 */
const staffEmail = process.env.E2E_MODERATOR_EMAIL ?? 'moderator@jcos.local';
const staffPassword = process.env.E2E_MODERATOR_PASSWORD ?? 'change-me-moderator';

async function loginStaff(page: import('@playwright/test').Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(staffEmail);
  await page.getByLabel('Пароль').fill(staffPassword);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/admin(\/)?(\?.*)?$/, { timeout: 15_000 });
}

test.describe('Order chat — orders list', () => {
  test('orders table exposes chat affordance per row', async ({ page }) => {
    await loginStaff(page);
    await page.goto('/admin/orders');
    await expect(page.getByRole('heading', { name: 'Заказы' })).toBeVisible();

    const firstChatLink = page.locator('a[href*="#order-chat"]').first();
    const rowCount = await page.locator('tbody tr').count();
    test.skip(rowCount === 0, 'No orders in seed — skip chat column check');

    await expect(firstChatLink).toBeVisible();
    await expect(firstChatLink).toHaveAttribute('href', /\/admin\/orders\/[^#]+#order-chat/);
  });
});
