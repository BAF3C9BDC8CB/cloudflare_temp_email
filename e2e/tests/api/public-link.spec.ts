import { test, expect } from '@playwright/test';
import { WORKER_URL, createTestAddress, seedTestMail, deleteAddress } from '../../fixtures/test-helpers';

const tokenHeaders = (token: string) => ({ 'x-public-token': token });
const bearer = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

test.describe('Public Mail Link API', () => {
  test('creates, reads, regenerates, and revokes a public link', async ({ request }) => {
    const created = await createTestAddress(request, 'pub-link');
    await seedTestMail(request, created.address, { subject: 'Public Link Test' });
    try {
      const create = await request.post(`${WORKER_URL}/api/public_link`, { headers: bearer(created.jwt) });
      expect(create.ok()).toBe(true);
      const token = (await create.json()).token;
      expect(token).toMatch(/^[0-9A-Za-z]{10}$/);

      const current = await request.get(`${WORKER_URL}/api/public_link`, { headers: bearer(created.jwt) });
      expect((await current.json()).token).toBe(token);
      const list = await request.get(`${WORKER_URL}/public_api/mails?limit=20&offset=0`, { headers: tokenHeaders(token) });
      expect(list.ok()).toBe(true);
      const body = await list.json();
      expect(body.address).toBe(created.address);
      expect(body.results.some((mail: any) => mail.subject === 'Public Link Test')).toBe(true);

      for (const value of ['abc', '20abc', '1.5', ' 20', '20 ', '020']) {
        const invalidOffset = await request.get(`${WORKER_URL}/public_api/mails?limit=20&offset=${encodeURIComponent(value)}`, { headers: tokenHeaders(token) });
        expect(invalidOffset.status()).toBe(400);
        expect(await invalidOffset.text()).toContain('Invalid offset');
      }

      for (const value of ['abc', '20abc', '1.5', ' 20', '20 ', '020']) {
        const invalidLimit = await request.get(`${WORKER_URL}/public_api/mails?limit=${encodeURIComponent(value)}&offset=0`, { headers: tokenHeaders(token) });
        expect(invalidLimit.status()).toBe(400);
        expect(await invalidLimit.text()).toContain('Invalid limit');
      }

      const regenerated = await request.post(`${WORKER_URL}/api/public_link`, { headers: bearer(created.jwt) });
      const newToken = (await regenerated.json()).token;
      expect(newToken).not.toBe(token);
      expect((await request.get(`${WORKER_URL}/public_api/mails`, { headers: tokenHeaders(token) })).status()).toBe(404);

      expect((await request.delete(`${WORKER_URL}/api/public_link`, { headers: bearer(created.jwt) })).ok()).toBe(true);
      expect((await request.get(`${WORKER_URL}/public_api/mails`, { headers: tokenHeaders(newToken) })).status()).toBe(404);
    } finally {
      await deleteAddress(request, created.jwt);
    }
  });

  test('does not resolve missing or malformed tokens', async ({ request }) => {
    expect((await request.get(`${WORKER_URL}/public_api/mails`)).status()).toBe(404);
    expect((await request.get(`${WORKER_URL}/public_api/mails`, { headers: tokenHeaders('short') })).status()).toBe(404);
    expect((await request.get(`${WORKER_URL}/public_api/mails`, { headers: tokenHeaders('!'.repeat(10)) })).status()).toBe(404);
  });

  test('isolates mailboxes and removes links when an address is deleted', async ({ request }) => {
    const addressA = await createTestAddress(request, 'pub-isolation-a');
    const addressB = await createTestAddress(request, 'pub-isolation-b');
    try {
      await seedTestMail(request, addressA.address, { subject: 'Private Mail A' });
      await seedTestMail(request, addressB.address, { subject: 'Private Mail B' });

      const link = await request.post(`${WORKER_URL}/api/public_link`, { headers: bearer(addressA.jwt) });
      const token = (await link.json()).token;
      const list = await request.get(`${WORKER_URL}/public_api/mails`, { headers: tokenHeaders(token) });
      expect(list.ok()).toBe(true);
      const body = await list.json();
      expect(body.address).toBe(addressA.address);
      expect(body.results.every((mail: any) => mail.address === addressA.address)).toBe(true);
      expect(body.results.some((mail: any) => mail.subject === 'Private Mail B')).toBe(false);

      await deleteAddress(request, addressA.jwt);
      expect((await request.get(`${WORKER_URL}/public_api/mails`, { headers: tokenHeaders(token) })).status()).toBe(404);
    } finally {
      await deleteAddress(request, addressB.jwt);
    }
  });
});
