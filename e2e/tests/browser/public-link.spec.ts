import { test, expect, request as apiRequest } from '@playwright/test';
import { FRONTEND_URL, createTestAddress, seedTestMail, deleteAddress } from '../../fixtures/test-helpers';

test('public mailbox is read-only and owner can copy its link', async ({ page, context }) => {
  const api = await apiRequest.newContext();
  const created = await createTestAddress(api, 'pub-browser');
  await seedTestMail(api, created.address, { subject: 'Public Browser Mail' });
  try {
    const create = await api.post(`${process.env.WORKER_URL}/api/public_link`, {
      headers: { Authorization: `Bearer ${created.jwt}` },
    });
    const { token } = await create.json();
    await page.goto(`${FRONTEND_URL}/m/${token}`);
    await expect(page.getByText('Public Browser Mail')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /delete|reply|forward/i })).toHaveCount(0);

    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: FRONTEND_URL });
    await page.goto(`${FRONTEND_URL}/en/?jwt=${created.jwt}`);
    await page.getByRole('button', { name: 'Copy Public Link' }).first().click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`/m/${token}`);
  } finally {
    await deleteAddress(api, created.jwt);
    await api.dispose();
  }
});
