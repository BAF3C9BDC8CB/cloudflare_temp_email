import { expect, request as apiRequest, test } from '@playwright/test';

import {
  FRONTEND_URL,
  createTestAddress,
  deleteAddress,
  seedTestMail,
} from '../../fixtures/test-helpers';

test('public mailbox is content-only and read-only', async ({ page }) => {
  const api = await apiRequest.newContext();
  const created = await createTestAddress(api, 'branding-public');
  const subject = 'Private Mail branding acceptance';
  const body = 'Public mailbox content remains available.';

  try {
    await seedTestMail(api, created.address, {
      subject,
      text: body,
      html: `<p>${body}</p>`,
    });
    const linkResponse = await api.post(`${process.env.WORKER_URL}/api/public_link`, {
      headers: { Authorization: `Bearer ${created.jwt}` },
    });
    expect(linkResponse.ok()).toBeTruthy();
    const { token } = await linkResponse.json();

    await page.goto(`${FRONTEND_URL}/m/${token}`);

    await expect(page.getByText(created.address)).toBeVisible();
    await expect(page.getByText(subject)).toBeVisible();
    await expect(page.locator('.mail-content')).toBeVisible();
    await expect(page.getByRole('button', { name: /refresh|刷新/i })).toBeVisible();
    await expect(page.getByPlaceholder(/filter current page|过滤当前页/i)).toBeVisible();
    await expect(page.locator('.n-pagination')).toBeVisible();

    await expect(page.locator('header, footer')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByText(/Private Mail|私有邮箱/)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /github|source/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /delete|reply|forward|save to s3/i })).toHaveCount(0);

    await page.getByPlaceholder(/filter current page|过滤当前页/i).fill(subject);
    await expect(page.getByText(subject)).toBeVisible();
  } finally {
    await deleteAddress(api, created.jwt);
    await api.dispose();
  }
});

test('normal English route keeps Private Mail branding and controls', async ({ page }) => {
  await page.goto(`${FRONTEND_URL}/en/`);

  await expect(page.getByText('Private Mail').first()).toBeVisible();
  await expect(page.locator('.brand-avatar[aria-label="Private Mail"]')).toBeVisible();
  await expect(page.locator('.brand-avatar[src="/private-mail-icon.svg"]')).toBeVisible();
  await expect(page.getByText('Home')).toBeVisible();
  await expect(page.getByRole('button', { name: /English|language/i })).toBeVisible();
  await expect(page.getByText(/Dark|Light/)).toBeVisible();
  await expect(page.getByRole('link', { name: /github|source/i })).toHaveCount(0);
});

test('normal Chinese route localizes the Private Mail brand', async ({ page }) => {
  await page.goto(`${FRONTEND_URL}/zh/`);

  await expect(page.getByText('私有邮箱').first()).toBeVisible();
  await expect(page.getByText('主页')).toBeVisible();
  await expect(page.getByRole('button', { name: /中文|语言/i })).toBeVisible();
});
