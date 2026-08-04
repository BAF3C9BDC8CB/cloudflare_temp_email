# Public Mail Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every mailbox address a permanent, revocable short public link (`/m/<10-char Base62 token>`) plus a read-only public mailbox page that reuses the existing `MailBox`/`MailContentRenderer` components.

**Architecture:** A new D1 table `address_public_link` (1:1 address↔token) is created idempotently via the worker's existing `DB_INIT_QUERIES` auto-migration. Address-scoped link management endpoints (`POST/GET/DELETE /api/public_link`, existing Bearer-JWT auth) let the owner create/read/revoke their link. A new token-authenticated read endpoint (`GET /public_api/mails`, `x-public-token` header) serves only that mailbox's rows via the existing `handleMailListQuery`. The frontend gets a new SPA route `/m/:token` rendering a read-only `MailBox` page, plus copy/revoke buttons in `AddressSelect.vue` and a per-row copy button in the user's `AddressManagement.vue`. Tokens are CSPRNG Base62 with rejection sampling; no expiry by requirement.

**Tech Stack:** Hono (worker), D1 (SQLite), Cloudflare Pages middleware (`pages/functions`), Vue 3 + vue-router + Naive UI, vitest (frontend unit), `node --test` (worker unit, Node 24 type-stripping like `junk_mail_policy.test.mjs`), Playwright + Docker Compose (e2e).

## Global Constraints

- **Auth routing:** `/api/*` requires Bearer address JWT (existing middleware). `/public_api/*` is a NEW public prefix: must be added to `API_PATHS` in `worker/src/worker.ts` **and** `pages/functions/_middleware.js`, exempted from the `x-custom-auth` check (like `/open_api`), added to the rate-limit block, and proxied by the e2e vite config in `e2e/Dockerfile.frontend`.
- **No arbitrary address lookup:** public endpoints accept only a token; never an address. Malformed and unknown tokens return the same `404 PublicLinkNotFoundMsg` (no oracle).
- **Token format:** exactly 10 chars from `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`; regex `/^[0-9A-Za-z]{10}$/` validated server-side before SQL.
- **One link per address** (`address_id UNIQUE`). Copy must never rotate an existing link: frontend flow is GET → POST only if `token` is null.
- **Read-only public page:** `MailBox` props `enableUserDeleteEmail=false`, `showReply=false`, `showSaveS3=false`.
- **Address management copy:** the user address table must expose a copy-public-link action after the existing unbind action; it uses that row's address JWT and must not change the active address.
- **Public reads must NOT call `updateAddressUpdatedAt`** (link views must not reset the inactivity cleanup timer).
- **DB version:** bump `CONSTANTS.DB_VERSION` `v0.0.7 → v0.0.8`; add table to `DB_INIT_QUERIES` in `worker/src/admin_api/db_api.ts`; create dated patch `db/2026-08-04-public-link.sql`.
- **Cleanup cascades:** delete `address_public_link` rows in `deleteAddressWithData`, `batchDeleteAddressWithData` (`worker/src/common.ts`) and in `transferAddress` (`worker/src/user_api/bind_address.ts`).
- **i18n:** worker messages in `worker/src/i18n/{type,zh,en}.ts`; frontend en/zh source of truth in `frontend/src/i18n/message-registry.ts`; add flat keys with English text to `frontend/src/i18n/locales/source/{de,es,ja,ptBR}.ts`.
- **Style:** worker TS uses tabs + single quotes; frontend uses 4-space indent; ESM imports only; Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`).
- **Node for `.mjs` tests:** run from `worker/` with `node --test` (Node ≥ 22.6 with type stripping; CI uses Node 24 — same as existing `worker/src/email/junk_mail_policy.test.mjs`).

---

### Task 1: Worker token generator (TDD, `node --test`)

**Files:**
- Create: `worker/src/public_api/token.ts`
- Test: `worker/src/public_api/token.test.mjs`

**Interfaces:**
- Produces: `TOKEN_LENGTH: 10`, `BASE62: string`, `PUBLIC_TOKEN_RE: RegExp`, `isValidPublicToken(token: unknown): token is string`, `generatePublicToken(): string`. Later tasks (4, 5) import these.

- [ ] **Step 1: Write the failing test** — create `worker/src/public_api/token.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
    generatePublicToken,
    isValidPublicToken,
    PUBLIC_TOKEN_RE,
    TOKEN_LENGTH,
} from "./token.ts";

test("generated tokens are TOKEN_LENGTH-char base62", () => {
    assert.equal(TOKEN_LENGTH, 10);
    for (let i = 0; i < 100; i++) {
        const t = generatePublicToken();
        assert.equal(t.length, TOKEN_LENGTH);
        assert.match(t, PUBLIC_TOKEN_RE);
    }
});

test("tokens are not trivially repeated", () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
        seen.add(generatePublicToken());
    }
    assert.ok(seen.size > 400, `only ${seen.size} unique tokens in 500`);
});

test("isValidPublicToken rejects malformed input", () => {
    assert.equal(isValidPublicToken(null), false);
    assert.equal(isValidPublicToken(undefined), false);
    assert.equal(isValidPublicToken(""), false);
    assert.equal(isValidPublicToken("short"), false);
    assert.equal(isValidPublicToken("a".repeat(11)), false);
    assert.equal(isValidPublicToken("!".repeat(10)), false);
    assert.equal(isValidPublicToken("0Ab9ZzXy12"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/public_api/token.test.mjs` (from `worker/`)
Expected: FAIL — `Cannot find module './token.ts'` (or import error).

- [ ] **Step 3: Write minimal implementation** — create `worker/src/public_api/token.ts`:

```ts
export const TOKEN_LENGTH = 10;

export const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const PUBLIC_TOKEN_RE = /^[0-9A-Za-z]{10}$/;

export const isValidPublicToken = (token: unknown): token is string =>
    typeof token === "string" && PUBLIC_TOKEN_RE.test(token);

/**
 * Generate a 10-char Base62 token using Web Crypto with rejection
 * sampling (reject bytes >= 248 = 62*4) to avoid modulo bias.
 * ~83 bits of entropy; collision probability is negligible.
 */
export const generatePublicToken = (): string => {
    const bytes = new Uint8Array(TOKEN_LENGTH);
    let token = "";
    while (token.length < TOKEN_LENGTH) {
        crypto.getRandomValues(bytes);
        for (const b of bytes) {
            if (b < 248) {
                token += BASE62[b % 62];
                if (token.length >= TOKEN_LENGTH) break;
            }
        }
    }
    return token;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/public_api/token.test.mjs` (from `worker/`)
Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/public_api/token.ts worker/src/public_api/token.test.mjs
git commit -m "feat: add CSPRNG base62 public-link token generator"
```

---

### Task 2: DB schema + auto-migration

**Files:**
- Create: `db/2026-08-04-public-link.sql`
- Modify: `worker/src/admin_api/db_api.ts` (append table to `DB_INIT_QUERIES`, after the `user_passkeys` index block, before the closing backtick at line 126)
- Modify: `worker/src/constants.ts:6` (`DB_VERSION: "v0.0.7"` → `"v0.0.8"`)

**Interfaces:**
- Produces: table `address_public_link(id, address_id UNIQUE NOT NULL, token UNIQUE NOT NULL, created_at)`. Tasks 4/5/7 read/write it with these exact column names.

- [ ] **Step 1: Create the dated patch** — create `db/2026-08-04-public-link.sql`:

```sql
-- Public mail link: permanent, revocable short link per mailbox address.
CREATE TABLE IF NOT EXISTS address_public_link (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address_id INTEGER UNIQUE NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_address_public_link_token ON address_public_link(token);
```

- [ ] **Step 2: Append the same DDL to `DB_INIT_QUERIES`** — in `worker/src/admin_api/db_api.ts`, insert before the closing backtick of `DB_INIT_QUERIES` (line 126), right after the `user_passkeys` unique index line:

```ts
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_passkeys_user_id_passkey_id ON user_passkeys(user_id, passkey_id);

CREATE TABLE IF NOT EXISTS address_public_link (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address_id INTEGER UNIQUE NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_address_public_link_token ON address_public_link(token);
`
```

- [ ] **Step 3: Bump the DB version** — in `worker/src/constants.ts`, change `DB_VERSION: "v0.0.7"` to `DB_VERSION: "v0.0.8"`.

- [ ] **Step 4: Verify**

Run: `pnpm lint` (from `worker/`) — Expected: no errors.
Manual sanity (if sqlite3 available): `sqlite3 :memory: < ../db/2026-08-04-public-link.sql && echo OK`.

- [ ] **Step 5: Commit**

```bash
git add db/2026-08-04-public-link.sql worker/src/admin_api/db_api.ts worker/src/constants.ts
git commit -m "feat: add address_public_link table and bump DB version to v0.0.8"
```

---

### Task 3: E2E API spec for the public link (write failing tests)

**Files:**
- Create: `e2e/tests/api/public-link.spec.ts`

**Interfaces:**
- Consumes: `createTestAddress`, `seedTestMail`, `deleteAddress`, `WORKER_URL` from `../../fixtures/test-helpers`.
- Produces: the acceptance suite that Tasks 4, 5, 7 must turn green.

- [ ] **Step 1: Write the full spec** — create `e2e/tests/api/public-link.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import {
    WORKER_URL,
    createTestAddress,
    seedTestMail,
    deleteAddress,
} from '../../fixtures/test-helpers';

const TOKEN_RE = /^[0-9A-Za-z]{10}$/;

const bearer = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });
const publicHeaders = (token: string) => ({ 'x-public-token': token });

test.describe('Public Mail Link API', () => {
  test('create link, list mails via token, regenerate revokes old token', async ({ request }) => {
    const created = await createTestAddress(request, 'pub-link');
    const { jwt, address } = created;
    await seedTestMail(request, address, { subject: 'Public Link Test' });

    // Create link
    const createRes = await request.post(`${WORKER_URL}/api/public_link`, { headers: bearer(jwt) });
    expect(createRes.ok()).toBe(true);
    const { token } = await createRes.json();
    expect(token).toMatch(TOKEN_RE);

    // GET returns the same token (no rotation on read)
    const getRes = await request.get(`${WORKER_URL}/api/public_link`, { headers: bearer(jwt) });
    expect((await getRes.json()).token).toBe(token);

    // List mails with the token
    const listRes = await request.get(`${WORKER_URL}/public_api/mails?limit=20&offset=0`, { headers: publicHeaders(token) });
    expect(listRes.ok()).toBe(true);
    const list = await listRes.json();
    expect(list.address).toBe(address);
    expect(list.count).toBeGreaterThan(0);
    expect(list.results.some((r: any) => r.subject === 'Public Link Test')).toBe(true);

    // Regenerate: old token must become invalid, new token works
    const regenRes = await request.post(`${WORKER_URL}/api/public_link`, { headers: bearer(jwt) });
    const { token: newToken } = await regenRes.json();
    expect(newToken).not.toBe(token);
    const oldList = await request.get(`${WORKER_URL}/public_api/mails`, { headers: publicHeaders(token) });
    expect(oldList.status()).toBe(404);
    const newList = await request.get(`${WORKER_URL}/public_api/mails`, { headers: publicHeaders(newToken) });
    expect(newList.ok()).toBe(true);
  });

  test('token sees only its own mailbox; revoke takes effect immediately', async ({ request }) => {
    const a = await createTestAddress(request, 'pub-revoke-a');
    const b = await createTestAddress(request, 'pub-revoke-b');
    await seedTestMail(request, a.address, { subject: 'Secret Mail A' });
    await seedTestMail(request, b.address, { subject: 'Secret Mail B' });

    const createRes = await request.post(`${WORKER_URL}/api/public_link`, { headers: bearer(a.jwt) });
    const tokenA = (await createRes.json()).token;

    // A's token must not leak B's mails
    const listA = await request.get(`${WORKER_URL}/public_api/mails`, { headers: publicHeaders(tokenA) });
    expect(listA.ok()).toBe(true);
    const body = await listA.json();
    expect(body.results.every((r: any) => r.address === a.address)).toBe(true);
    expect(body.results.some((r: any) => r.subject === 'Secret Mail B')).toBe(false);

    // Revoke
    const revokeRes = await request.delete(`${WORKER_URL}/api/public_link`, { headers: bearer(a.jwt) });
    expect(revokeRes.ok()).toBe(true);
    const after = await request.get(`${WORKER_URL}/public_api/mails`, { headers: publicHeaders(tokenA) });
    expect(after.status()).toBe(404);

    // GET now reports null
    const getRes = await request.get(`${WORKER_URL}/api/public_link`, { headers: bearer(a.jwt) });
    expect((await getRes.json()).token).toBeNull();
  });

  test('deleting the address removes its public link', async ({ request }) => {
    const created = await createTestAddress(request, 'pub-del');
    const createRes = await request.post(`${WORKER_URL}/api/public_link`, { headers: bearer(created.jwt) });
    const token = (await createRes.json()).token;
    await deleteAddress(request, created.jwt);
    const after = await request.get(`${WORKER_URL}/public_api/mails`, { headers: publicHeaders(token) });
    expect(after.status()).toBe(404);
  });

  test('malformed or missing token returns 404', async ({ request }) => {
    const res1 = await request.get(`${WORKER_URL}/public_api/mails`);
    expect(res1.status()).toBe(404);
    const res2 = await request.get(`${WORKER_URL}/public_api/mails`, { headers: publicHeaders('short') });
    expect(res2.status()).toBe(404);
    const res3 = await request.get(`${WORKER_URL}/public_api/mails`, { headers: publicHeaders('!'.repeat(10)) });
    expect(res3.status()).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails (red)**

```bash
cd e2e && docker compose up -d --build
docker compose run --rm e2e-runner npx playwright test tests/api/public-link.spec.ts --project=api
```
Expected: FAIL — `POST /api/public_link` returns 404 "Not Found"; `GET /public_api/mails` returns 404.

> Keep the containers up (`docker compose up -d`) across Tasks 3–5; only the worker source changes need `docker compose build worker && docker compose up -d worker`. `docker compose down -v` at the end of Task 9.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/api/public-link.spec.ts
git commit -m "test: add e2e spec for public mail link API"
```

---

### Task 4: Link management API (`/api/public_link`)

**Files:**
- Create: `worker/src/mails_api/public_link.ts`
- Modify: `worker/src/mails_api/index.ts` (register 3 routes after the `address_auth` block, line 46)

**Interfaces:**
- Consumes: `generatePublicToken`, `isValidPublicToken` from `../public_api/token` (Task 1); `i18n`; `c.get("jwtPayload")`.
- Produces: handlers `createPublicLink`, `getPublicLink`, `revokePublicLink` (default-exported object) — registered on `/api/public_link`. Reads/writes table from Task 2.

- [ ] **Step 1: Write the implementation** — create `worker/src/mails_api/public_link.ts`:

```ts
import { Context } from 'hono'

import i18n from '../i18n';
import { generatePublicToken } from '../public_api/token';

const MAX_TOKEN_ATTEMPTS = 5;

const insertNewToken = async (
    c: Context<HonoCustomType>,
    address_id: number
): Promise<string> => {
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
        const token = generatePublicToken();
        try {
            const { success } = await c.env.DB.prepare(
                `INSERT INTO address_public_link (address_id, token) VALUES (?, ?)`
            ).bind(address_id, token).run();
            if (!success) {
                throw new Error("insert failed");
            }
            return token;
        } catch (e) {
            const message = (e as Error).message;
            // UNIQUE collision on token: retry with a fresh token
            if (message && message.includes("UNIQUE")) {
                continue;
            }
            throw e;
        }
    }
    throw new Error("failed to generate a unique token");
};

const createPublicLink = async (c: Context<HonoCustomType>) => {
    const msgs = i18n.getMessagesbyContext(c);
    const { address, address_id } = c.get("jwtPayload");
    if (!address || !address_id) {
        return c.text(msgs.InvalidAddressTokenMsg, 400);
    }
    // address row may have been deleted by cleanup while the JWT is still valid
    const db_address_id = await c.env.DB.prepare(
        `SELECT id FROM address WHERE id = ?`
    ).bind(address_id).first("id");
    if (!db_address_id) {
        return c.text(msgs.InvalidAddressMsg, 400);
    }
    // regenerate: remove the previous link so the old token stops working immediately
    await c.env.DB.prepare(
        `DELETE FROM address_public_link WHERE address_id = ?`
    ).bind(address_id).run();
    const token = await insertNewToken(c, address_id);
    return c.json({ token });
};

const getPublicLink = async (c: Context<HonoCustomType>) => {
    const msgs = i18n.getMessagesbyContext(c);
    const { address, address_id } = c.get("jwtPayload");
    if (!address || !address_id) {
        return c.text(msgs.InvalidAddressTokenMsg, 400);
    }
    const token = await c.env.DB.prepare(
        `SELECT token FROM address_public_link WHERE address_id = ?`
    ).bind(address_id).first<string>("token");
    return c.json({ token: token ?? null });
};

const revokePublicLink = async (c: Context<HonoCustomType>) => {
    const msgs = i18n.getMessagesbyContext(c);
    const { address, address_id } = c.get("jwtPayload");
    if (!address || !address_id) {
        return c.text(msgs.InvalidAddressTokenMsg, 400);
    }
    await c.env.DB.prepare(
        `DELETE FROM address_public_link WHERE address_id = ?`
    ).bind(address_id).run();
    return c.json({ success: true });
};

export default { createPublicLink, getPublicLink, revokePublicLink };
```

- [ ] **Step 2: Register the routes** — in `worker/src/mails_api/index.ts`, add after the `address_auth` block (after line 45):

```ts
import public_link from './public_link';
// ...
// public mail link
api.post('/api/public_link', public_link.createPublicLink)
api.get('/api/public_link', public_link.getPublicLink)
api.delete('/api/public_link', public_link.revokePublicLink)
```

- [ ] **Step 3: Verify lint + rebuild + rerun e2e**

```bash
pnpm lint
cd ../e2e && docker compose build worker && docker compose up -d worker
docker compose run --rm e2e-runner npx playwright test tests/api/public-link.spec.ts --project=api
```
Expected: the first two tests now pass for the `POST/GET/DELETE /api/public_link` and regenerate/revoke assertions; `GET /public_api/mails` assertions still FAIL (endpoint not implemented yet — Task 5).

- [ ] **Step 4: Commit**

```bash
git add worker/src/mails_api/public_link.ts worker/src/mails_api/index.ts
git commit -m "feat: add address-scoped public link create/read/revoke API"
```

---

### Task 5: Public read API + routing wiring + cleanup cascades

**Files:**
- Create: `worker/src/public_api/index.ts`
- Modify: `worker/src/worker.ts` (import + mount, `API_PATHS`, `x-custom-auth` exemption, rate-limit block)
- Modify: `pages/functions/_middleware.js` (route `/public_api/`)
- Modify: `e2e/Dockerfile.frontend` (vite proxy)
- Modify: `worker/src/i18n/type.ts`, `worker/src/i18n/zh.ts`, `worker/src/i18n/en.ts` (`PublicLinkNotFoundMsg`)
- Modify: `worker/src/common.ts` (`deleteAddressWithData`, `batchDeleteAddressWithData` cascade)
- Modify: `worker/src/user_api/bind_address.ts` (`transferAddress` cascade)

**Interfaces:**
- Consumes: `isValidPublicToken` (Task 1), `handleMailListQuery` from `../common`, table from Task 2.
- Produces: `api` Hono router with `GET /public_api/mails`; helper `getAddressByPublicToken(c, token): Promise<string | null>`. Later tasks (6+) call the endpoint from the frontend.

- [ ] **Step 1: Write the public read API** — create `worker/src/public_api/index.ts`:

```ts
import { Hono, Context } from 'hono'

import i18n from '../i18n';
import { handleMailListQuery } from '../common';
import { isValidPublicToken } from './token';

/**
 * Resolve the address bound to a public token, or null.
 * Malformed and unknown tokens both return null → identical 404 (no oracle).
 * NOTE: intentionally does NOT call updateAddressUpdatedAt, so public link
 * views never reset the inactive-address cleanup timer.
 */
const getAddressByPublicToken = async (
    c: Context<HonoCustomType>,
    token: string | null
): Promise<string | null> => {
    if (!token || !isValidPublicToken(token)) {
        return null;
    }
    const row = await c.env.DB.prepare(
        `SELECT a.name FROM address_public_link l `
        + `JOIN address a ON a.id = l.address_id `
        + `WHERE l.token = ?`
    ).bind(token).first<{ name: string }>();
    return row?.name ?? null;
};

const listPublicMails = async (c: Context<HonoCustomType>) => {
    const msgs = i18n.getMessagesbyContext(c);
    const token = c.req.raw.headers.get("x-public-token");
    const address = await getAddressByPublicToken(c, token);
    if (!address) {
        return c.text(msgs.PublicLinkNotFoundMsg, 404);
    }
    const { limit, offset } = c.req.query();
    const res = await handleMailListQuery(c,
        `SELECT * FROM raw_mails where address = ?`,
        `SELECT count(*) as count FROM raw_mails where address = ?`,
        [address], limit, offset
    );
    if (res.status !== 200) return res;
    const body = await res.json() as { results: Record<string, unknown>[], count: number };
    return c.json({ ...body, address });
};

export const api = new Hono<HonoCustomType>();

api.get('/public_api/mails', listPublicMails);

export default api;
```

- [ ] **Step 2: Wire the worker** — in `worker/src/worker.ts`:

1. Add import after the `mailsApi` import (line 8):
```ts
import { api as publicApi } from './public_api'
```
2. Add `"/public_api/",` to `API_PATHS` (line 20–27 array).
3. Exempt from `x-custom-auth` (line 56):
```ts
if (!c.req.path.startsWith("/open_api") && !c.req.path.startsWith("/telegram/")
    && !c.req.path.startsWith("/public_api/") && passwords && passwords.length > 0) {
```
4. Add to the rate-limit block (line 64–70, alongside `new_address`/`send_mail`):
```ts
|| c.req.path.startsWith("/public_api/")
```
5. Mount after `app.route('/', mailsApi)` (line 258):
```ts
app.route('/', publicApi)
```

- [ ] **Step 3: Route the prefix in Pages middleware** — in `pages/functions/_middleware.js`, add `"/public_api/",` to `API_PATHS` (line 1–8).

- [ ] **Step 4: Proxy the prefix in the e2e frontend** — in `e2e/Dockerfile.frontend`, add to the vite `proxy` object (after the `"/open_api"` line):
```
"/public_api": { target: workerTarget, changeOrigin: true },
```

- [ ] **Step 5: Add the worker i18n message** — in `worker/src/i18n/type.ts` add near the address-related messages:
```ts
PublicLinkNotFoundMsg: string
```
In `worker/src/i18n/zh.ts`:
```ts
PublicLinkNotFoundMsg: "公开链接不存在或已被撤销",
```
In `worker/src/i18n/en.ts`:
```ts
PublicLinkNotFoundMsg: "Public link not found or revoked",
```

- [ ] **Step 6: Add cleanup cascades** — in `worker/src/common.ts`:

In `deleteAddressWithData` (after the `users_address` delete, ~line 593):
```ts
const { success: publicLinkSuccess } = await c.env.DB.prepare(
    `DELETE FROM address_public_link WHERE address_id = ? `
).bind(address_id).run();
```
and add `!publicLinkSuccess` to the failure check at the end (line 601).

In `batchDeleteAddressWithData` (after the `users_address` delete, ~line 545):
```ts
await c.env.DB.prepare(
    `DELETE FROM address_public_link WHERE address_id IN ( ` +
    `SELECT id FROM address WHERE ${addressQueryCondition})`
).run();
```

In `worker/src/user_api/bind_address.ts` `transferAddress` (right after `DELETE FROM address WHERE id = ?`, ~line 223):
```ts
await c.env.DB.prepare(
    `DELETE FROM address_public_link WHERE address_id = ? `
).bind(address_id).run();
```

- [ ] **Step 7: Verify lint + rebuild + rerun e2e**

```bash
pnpm lint
cd ../e2e && docker compose build worker frontend && docker compose up -d worker frontend
docker compose run --rm e2e-runner npx playwright test tests/api/public-link.spec.ts --project=api
```
Expected: ALL tests in `public-link.spec.ts` PASS (read list, scoping, revoke-404, delete-address cleanup, malformed token).

- [ ] **Step 8: Commit**

```bash
git add worker/src/public_api/index.ts worker/src/worker.ts pages/functions/_middleware.js e2e/Dockerfile.frontend worker/src/i18n/type.ts worker/src/i18n/zh.ts worker/src/i18n/en.ts worker/src/common.ts worker/src/user_api/bind_address.ts
git commit -m "feat: add token-authenticated public mail list API and cleanup cascades"
```

---

### Task 6: Frontend helpers + unit tests (TDD, vitest)

**Files:**
- Create: `frontend/src/utils/public-link.js`
- Test: `frontend/src/utils/__tests__/public-link.test.js`

**Interfaces:**
- Produces: `PUBLIC_TOKEN_RE`, `isValidPublicToken(token): boolean`, `buildPublicLinkUrl(token): string` (returns `/m/<token>` or `''`). Task 7 uses both.

- [ ] **Step 1: Write the failing test** — create `frontend/src/utils/__tests__/public-link.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { isValidPublicToken, buildPublicLinkUrl } from '../public-link'

describe('public-link helpers', () => {
    it('accepts 10-char base62 tokens', () => {
        expect(isValidPublicToken('0Ab9ZzXy12')).toBe(true)
    })

    it('rejects wrong length or charset', () => {
        expect(isValidPublicToken(null)).toBe(false)
        expect(isValidPublicToken('')).toBe(false)
        expect(isValidPublicToken('short')).toBe(false)
        expect(isValidPublicToken('a'.repeat(11))).toBe(false)
        expect(isValidPublicToken('!'.repeat(10))).toBe(false)
    })

    it('builds /m/ link from a valid token', () => {
        expect(buildPublicLinkUrl('0Ab9ZzXy12')).toBe('/m/0Ab9ZzXy12')
    })

    it('returns empty string for invalid token', () => {
        expect(buildPublicLinkUrl('bad')).toBe('')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test` (from `frontend/`)
Expected: FAIL — `Cannot find module '../public-link'`.

- [ ] **Step 3: Write minimal implementation** — create `frontend/src/utils/public-link.js`:

```js
export const PUBLIC_TOKEN_RE = /^[0-9A-Za-z]{10}$/

export const isValidPublicToken = (token) =>
    typeof token === 'string' && PUBLIC_TOKEN_RE.test(token)

export const buildPublicLinkUrl = (token) =>
    isValidPublicToken(token) ? `/m/${token}` : ''
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test` (from `frontend/`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/public-link.js frontend/src/utils/__tests__/public-link.test.js
git commit -m "feat: add public link URL helpers"
```

---

### Task 7: Public page route + `PublicMail.vue` + API client header merge

**Files:**
- Create: `frontend/src/views/PublicMail.vue`
- Modify: `frontend/src/router/index.js` (add route before the `not-found` catch-all, after line 44)
- Modify: `frontend/src/api/index.js` (merge `options.headers` into the axios headers, after line 46)

**Interfaces:**
- Consumes: `isValidPublicToken`, `buildPublicLinkUrl` (Task 6 — used for defensive early check); `MailBox`; `api.fetch`; `useHead` from `@unhead/vue`.
- Produces: route `/m/:token` (alias `/:lang/m/:token`); read-only public mailbox page. Task 8's browser e2e exercises it.

- [ ] **Step 1: Merge caller headers in the API client** — in `frontend/src/api/index.js`, right after the `authorizationHeader` line (~line 46), add:

```js
        // merge caller-supplied headers (e.g. x-public-token for the public mail page)
        if (options.headers) Object.assign(headers, options.headers);
```

- [ ] **Step 2: Add the route** — in `frontend/src/router/index.js`, add before the `not-found` route:

```js
        {
            path: '/m/:token',
            alias: '/:lang/m/:token',
            component: () => import('../views/PublicMail.vue')
        },
```

- [ ] **Step 3: Create the public page** — create `frontend/src/views/PublicMail.vue`:

```vue
<script setup>
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { useScopedI18n } from '@/i18n/app'

import { useGlobalState } from '../store'
import { api } from '../api'
import MailBox from '../components/MailBox.vue'
import { isValidPublicToken } from '../utils/public-link'

const route = useRoute()
const message = useMessage()
const { t } = useScopedI18n('views.PublicMail')
const { openSettings } = useGlobalState()

const token = typeof route.params.token === 'string' ? route.params.token : ''
const invalidToken = ref(!isValidPublicToken(token))
const rateLimited = ref(false)
const mailboxAddress = ref('')

useHead({
    title: () => t('publicMailbox'),
    meta: [{ name: 'referrer', content: 'no-referrer' }],
})

onMounted(async () => {
    await api.getOpenSettings()
})

const fetchMailData = async (limit, offset) => {
    if (!isValidPublicToken(token)) {
        invalidToken.value = true
        return { results: [], count: 0 }
    }
    try {
        const res = await api.fetch(
            `/public_api/mails?limit=${limit}&offset=${offset}`,
            { headers: { 'x-public-token': token } }
        )
        mailboxAddress.value = res.address || ''
        return res
    } catch (error) {
        const msg = error.message || ''
        if (msg.startsWith('[404]')) invalidToken.value = true
        else if (msg.startsWith('[429]')) rateLimited.value = true
        else message.error(msg)
        throw error
    }
}
</script>

<template>
    <div class="public-mail">
        <n-card v-if="invalidToken" :bordered="false" embedded class="state-card">
            <n-result status="404" :title="t('invalidLink')" :description="t('invalidLinkTip')" />
        </n-card>
        <n-card v-else-if="rateLimited" :bordered="false" embedded class="state-card">
            <n-result status="error" title="429" :description="t('rateLimited')" />
        </n-card>
        <template v-else>
            <n-card :bordered="false" embedded class="header-card">
                <n-flex align="center" justify="space-between" :wrap="false">
                    <span class="title">{{ openSettings.title || t('publicMailbox') }}</span>
                    <n-tag v-if="mailboxAddress" type="info" size="small">
                        {{ t('address') }}: {{ mailboxAddress }}
                    </n-tag>
                </n-flex>
            </n-card>
            <MailBox :showEMailTo="true" :enableUserDeleteEmail="false" :showReply="false"
                :showSaveS3="false" :showFilterInput="true" :fetchMailData="fetchMailData" />
        </template>
    </div>
</template>

<style scoped>
.public-mail {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 12px;
}

.state-card {
    max-width: 720px;
    margin: 20px auto;
}

.header-card {
    margin-top: 10px;
    margin-bottom: 10px;
}

.title {
    font-size: 16px;
    font-weight: 600;
}
</style>
```

- [ ] **Step 4: Verify build**

Run: `pnpm build` (from `frontend/`)
Expected: build succeeds, no unresolved imports.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/PublicMail.vue frontend/src/router/index.js frontend/src/api/index.js
git commit -m "feat: add public mail page at /m/:token reusing MailBox"
```

---

### Task 8: Copy / revoke buttons in address UIs + frontend i18n

**Files:**
- Modify: `frontend/src/components/AddressSelect.vue`
- Modify: `frontend/src/views/user/AddressManagement.vue`
- Modify: `frontend/src/i18n/message-registry.ts` (`components.AddressSelect` keys + new `views.PublicMail` namespace)
- Modify: `frontend/src/i18n/locales/source/{de,es,ja,ptBR}.ts` (flat keys, English text)

**Interfaces:**
- Consumes: `api.fetch` (`/api/public_link`), `toClipboard` (vue-clipboard3, already imported), `useRouter`.
- Produces: copy/revoke buttons next to the copy-address button when `showCopy` is true, plus a per-row copy-public-link action after unbind in the user address-management table.

- [ ] **Step 1: Add the buttons and handlers** — in `frontend/src/components/AddressSelect.vue`:

1. Add `useRouter` import and instance (script setup top):
```js
import { useRouter } from 'vue-router'
const router = useRouter()
```
2. Add handlers after the existing `copy` function:
```js
const copyPublicLink = async () => {
    try {
        let res = await api.fetch(`/api/public_link`)
        let token = res?.token
        if (!token) {
            const created = await api.fetch(`/api/public_link`, { method: 'POST' })
            token = created?.token
        }
        if (!token) {
            throw new Error("token not found")
        }
        const href = router.resolve({ path: '/m/' + token }).href
        await toClipboard(window.location.origin + href)
        message.success(t('publicLinkCopied'))
    } catch (error) {
        message.error(error.message || "error")
    }
}

const revokePublicLink = async () => {
    try {
        await api.fetch(`/api/public_link`, { method: 'DELETE' })
        message.success(t('publicLinkRevoked'))
    } catch (error) {
        message.error(error.message || "error")
    }
}
```
3. Add the buttons in the template, next to the existing copy button (line 221–223), wrapped in `v-if="showCopy"`:
```vue
        <n-button v-if="showCopy" class="address-copy" @click="copyPublicLink" :size="size" tertiary type="primary">
            <n-icon :component="Copy" /> {{ t('copyPublicLink') }}
        </n-button>
        <n-popconfirm v-if="showCopy" @positive-click="revokePublicLink">
            <template #trigger>
                <n-button class="address-copy" :size="size" tertiary type="warning">
                    {{ t('revokePublicLink') }}
                </n-button>
            </template>
            {{ t('publicLinkRevokeTip') }}
         </n-popconfirm>
```
4. Add a row-specific copy action in `frontend/src/views/user/AddressManagement.vue` after the existing unbind `NPopconfirm`. It must obtain a JWT for that row and pass it only as the explicit Authorization override:
```js
import useClipboard from 'vue-clipboard3'
import { buildPublicLinkUrl } from '../../utils/public-link'

const { toClipboard: copyToClipboard } = useClipboard()

const copyPublicLink = async (row) => {
    try {
        const { jwt: addressJwt } = await api.fetch(`/user_api/bind_address_jwt/${row.id}`)
        if (!addressJwt) throw new Error('jwt not found')
        let link = await api.fetch('/api/public_link', {
            headers: { Authorization: `Bearer ${addressJwt}` },
        })
        let token = link?.token
        if (!token) {
            link = await api.fetch('/api/public_link', {
                method: 'POST',
                headers: { Authorization: `Bearer ${addressJwt}` },
            })
            token = link?.token
        }
        const path = buildPublicLinkUrl(token)
        if (!path) throw new Error('token not found')
        await copyToClipboard(window.location.origin + path)
        message.success(t('publicLinkCopied'))
    } catch (error) {
        message.error(error.message || 'error')
    }
}
```
Render this immediately after the unbind action in the `columns` action array:
```js
h(NButton, {
    tertiary: true,
    type: 'primary',
    onClick: () => copyPublicLink(row),
}, { default: () => t('copyPublicLink') }),
```
The action must not call `changeMailAddress`, mutate `jwt.value`, or navigate.

- [ ] **Step 2: Add i18n keys** — in `frontend/src/i18n/message-registry.ts`:

Inside `"components.AddressSelect"` add:
```js
    "copyPublicLink": {
        "en": "Copy Public Link",
        "zh": "复制公开链接"
    },
    "publicLinkCopied": {
        "en": "Public link copied",
        "zh": "公开链接已复制"
    },
    "publicLinkRevokeTip": {
        "en": "The public link will stop working immediately. Continue?",
        "zh": "撤销后公开链接将立即失效，确定继续吗？"
    },
    "publicLinkRevoked": {
        "en": "Public link revoked",
        "zh": "公开链接已撤销"
    },
    "revokePublicLink": {
        "en": "Revoke Public Link",
        "zh": "撤销公开链接"
    },
```

Inside the existing `"views.user.AddressManagement"` namespace add the same copy label and success message so the row action uses its own scoped translator:
```js
    "copyPublicLink": {
        "en": "Copy Public Link",
        "zh": "复制公开链接"
    },
    "publicLinkCopied": {
        "en": "Public link copied",
        "zh": "公开链接已复制"
    },
```

Add a new top-level namespace `"views.PublicMail"`:
```js
  "views.PublicMail": {
    "address": {
      "en": "Mailbox",
      "zh": "邮箱地址"
    },
    "invalidLink": {
      "en": "Invalid or revoked link",
      "zh": "链接无效或已被撤销"
    },
    "invalidLinkTip": {
      "en": "This public link does not exist or has been revoked by its owner.",
      "zh": "该公开链接不存在，或已被所有者撤销。"
    },
    "publicMailbox": {
      "en": "Public Mailbox",
      "zh": "公开邮箱"
    },
    "rateLimited": {
      "en": "Too many requests, please try again later.",
      "zh": "请求过于频繁，请稍后重试。"
    }
  },
```

- [ ] **Step 3: Add flat keys to the additional locales** — append to each of `frontend/src/i18n/locales/source/{de,es,ja,ptBR}.ts` (English text; missing translations fall back to en):
```js
  "components.AddressSelect.copyPublicLink": "Copy Public Link",
  "components.AddressSelect.publicLinkCopied": "Public link copied",
  "components.AddressSelect.publicLinkRevokeTip": "The public link will stop working immediately. Continue?",
  "components.AddressSelect.publicLinkRevoked": "Public link revoked",
  "components.AddressSelect.revokePublicLink": "Revoke Public Link",
  "views.PublicMail.address": "Mailbox",
  "views.PublicMail.invalidLink": "Invalid or revoked link",
  "views.PublicMail.invalidLinkTip": "This public link does not exist or has been revoked by its owner.",
  "views.PublicMail.publicMailbox": "Public Mailbox",
  "views.PublicMail.rateLimited": "Too many requests, please try again later.",
  "views.user.AddressManagement.copyPublicLink": "Copy Public Link",
  "views.user.AddressManagement.publicLinkCopied": "Public link copied",
```

- [ ] **Step 4: Verify**

Run: `pnpm test && pnpm build` (from `frontend/`)
Expected: unit tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AddressSelect.vue frontend/src/views/user/AddressManagement.vue frontend/src/i18n/message-registry.ts frontend/src/i18n/locales/source/de.ts frontend/src/i18n/locales/source/es.ts frontend/src/i18n/locales/source/ja.ts frontend/src/i18n/locales/source/ptBR.ts
git commit -m "feat: add public link actions to address UIs"
```

---

### Task 9: Browser e2e spec (public page + copy button)

**Files:**
- Create: `e2e/tests/browser/public-link.spec.ts`

**Interfaces:**
- Consumes: `FRONTEND_URL`, `WORKER_URL`, `createTestAddress`, `seedTestMail`, `deleteAddress` from `../../fixtures/test-helpers`; Task 5 wiring (`/public_api` proxy); Task 7 route; Task 8 button.

- [ ] **Step 1: Write the failing spec** — create `e2e/tests/browser/public-link.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import {
    FRONTEND_URL,
    createTestAddress,
    seedTestMail,
    deleteAddress,
} from '../../fixtures/test-helpers';
import { request as apiRequest } from '@playwright/test';

test.describe('Public Mail Link Browser Flow', () => {
  test('open /m/<token> shows the mailbox; copy button copies the link', async ({ page, context }) => {
    const api = await apiRequest.newContext();
    let jwt: string | undefined;
    try {
      const created = await createTestAddress(api, 'pub-browser');
      jwt = created.jwt;
      const address = created.address;
      await seedTestMail(api, address, { subject: 'Public Browser Mail' });

      const createRes = await api.post(`${process.env.WORKER_URL}/api/public_link`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const { token } = await createRes.json();

      // Public page: mailbox list + detail render read-only
      await page.goto(`${FRONTEND_URL}/m/${token}`);
      const mailItem = page.getByRole('listitem').getByText('Public Browser Mail');
      await expect(mailItem).toBeVisible({ timeout: 10_000 });
      await mailItem.click();
      await expect(page.getByRole('heading', { name: 'Public Browser Mail' }).first()).toBeVisible({ timeout: 5_000 });

      // Copy button on the owner page (English locale via /en/) copies the link
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: FRONTEND_URL });
      await page.goto(`${FRONTEND_URL}/en/?jwt=${jwt}`);
      await page.getByRole('button', { name: 'Copy Public Link' }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5_000 })
        .toContain(`/m/${token}`);
    } finally {
      try {
        if (jwt) await deleteAddress(api, jwt);
      } finally {
        await api.dispose();
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails (red)**

```bash
cd e2e && docker compose build frontend && docker compose up -d frontend
docker compose run --rm e2e-runner npx playwright test tests/browser/public-link.spec.ts --project=browser
```
Expected: FAIL — page shows "Invalid or revoked link" OR the copy button is missing (before Task 8, whichever is unbuilt). Debug with `npx playwright test ... --project=browser --trace on` if the dev-server rebuild is stale.

> If this test was written after Tasks 7/8 were already merged, it will pass immediately — that is fine; the red run requirement applies when tasks are executed in order in a fresh branch.

- [ ] **Step 3: Verify green + full cleanup**

```bash
docker compose run --rm e2e-runner npx playwright test tests/api/public-link.spec.ts tests/browser/public-link.spec.ts
docker compose down -v
```
Expected: both specs PASS; containers cleaned up.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/browser/public-link.spec.ts
git commit -m "test: add browser e2e for public mail link page and copy button"
```

---

### Task 10: VitePress docs (zh + en + sidebar)

**Files:**
- Create: `vitepress-docs/docs/zh/guide/feature/public-link.md`
- Create: `vitepress-docs/docs/en/guide/feature/public-link.md`
- Modify: `vitepress-docs/docs/.vitepress/zh.ts` (API 接口 section, after `feature/delete-address`, line ~183)
- Modify: `vitepress-docs/docs/.vitepress/en.ts` (API Endpoints section, after `feature/delete-address`, line ~183)

- [ ] **Step 1: Create the zh doc** — `vitepress-docs/docs/zh/guide/feature/public-link.md`:

```markdown
# 公开链接（Public Link）

邮箱地址可以生成一个**永久、可随时撤销**的短链接，任何拿到链接的人都可以**只读**查看该邮箱收到的邮件。

- 链接格式：`/m/<10 位 Base62 随机令牌>`，例如 `https://你的域名/m/Ab3xY9zKq2`
- 一个地址同时只有一个生效链接；重新生成会立即使旧链接失效
- 链接永不过期，但撤销后立即失效（删除服务端记录）

## 使用方法

1. 在首页地址栏（或用户邮箱）中，点击「复制公开链接」按钮：
   - 尚未生成时，首次点击会先生成再复制
   - 再次点击只会复制已有链接，不会轮换令牌
2. 将链接分享给任何人，对方打开即可查看该邮箱收到的全部邮件（无登录、只读）
3. 需要停止分享时，点击「撤销公开链接」并确认，链接立即 404

## API 参考

### 管理接口（需地址 JWT，`Authorization: Bearer <jwt>`）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/public_link` | 创建或重新生成链接，返回 `{ "token": "..." }`；旧令牌立即失效 |
| `GET` | `/api/public_link` | 读取当前链接，无则返回 `{ "token": null }` |
| `DELETE` | `/api/public_link` | 撤销链接（幂等），返回 `{ "success": true }` |

### 公开只读接口（无需登录，请求头 `x-public-token: <token>`）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/public_api/mails?limit=&offset=` | 分页列出该邮箱邮件，返回 `{ "results": [...], "count": n, "address": "..." }` |

错误码：

- `404`：令牌缺失、格式错误、已被撤销或不存在（三者返回一致，避免枚举探测）
- `429`：触发限流（与新建地址等接口共用限流器）
- 公开接口**只接受令牌**，不接受地址，无法按地址任意查询

## 安全说明

- 令牌由 Web Crypto 安全随机数生成（10 位 Base62，约 83 bit 熵），暴力猜测不可行
- 公开页面不提供删除、回复、转发、下载等写操作，仅复用现有邮件渲染与消毒管线
- 令牌属于敏感信息：分享前请确认接收方可信，泄露后可一键撤销
</markdown>
```

- [ ] **Step 2: Create the en doc** — `vitepress-docs/docs/en/guide/feature/public-link.md`:

```markdown
# Public Link

A mailbox address can have a **permanent, instantly revocable** short link. Anyone with the link can **read-only** view every mail received by that mailbox.

- Link format: `/m/<10-char Base62 random token>`, e.g. `https://your-domain/m/Ab3xY9zKq2`
- One address has at most one active link; regenerating immediately invalidates the old one
- Links never expire, but revocation takes effect immediately (server record deleted)

## Usage

1. On the home page address bar, click **Copy Public Link**:
   - First click generates the link if none exists, then copies it
   - Later clicks only copy the existing link — the token is never rotated by copying
2. Share the link with anyone; they can view all mails of that mailbox without logging in (read-only)
3. To stop sharing, click **Revoke Public Link** and confirm — the link 404s immediately

## API Reference

### Management endpoints (address JWT, `Authorization: Bearer <jwt>`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/public_link` | Create or regenerate the link; returns `{ "token": "..." }`; old token immediately invalid |
| `GET` | `/api/public_link` | Read the current link, or `{ "token": null }` |
| `DELETE` | `/api/public_link` | Revoke the link (idempotent); returns `{ "success": true }` |

### Public read endpoint (no login; header `x-public-token: <token>`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/public_api/mails?limit=&offset=` | Paginated mails of the mailbox; returns `{ "results": [...], "count": n, "address": "..." }` |

Errors:

- `404`: missing, malformed, revoked, or unknown token — all identical, preventing enumeration
- `429`: rate limited (shared limiter with address creation etc.)
- Public endpoints accept **tokens only**, never addresses, so arbitrary lookup is impossible

## Security notes

- Tokens come from Web Crypto (10-char Base62, ~83 bits of entropy); brute force is infeasible
- The public page exposes no delete/reply/forward/download actions and reuses the existing sanitization pipeline
- Treat the token as sensitive: only share with trusted recipients; you can revoke it in one click
</markdown>
```

- [ ] **Step 3: Add sidebar entries** — in `vitepress-docs/docs/.vitepress/zh.ts`, after the `delete-address` line in the `API 接口` section:
```ts
                { text: '公开链接 API', link: 'feature/public-link' },
```
In `vitepress-docs/docs/.vitepress/en.ts`, after the `delete-address` line in the `API Endpoints` section:
```ts
                { text: 'Public Link API', link: 'feature/public-link' },
```

- [ ] **Step 4: Verify build**

Run: `pnpm build` (from `vitepress-docs/`)
Expected: build succeeds, both new pages included.

- [ ] **Step 5: Commit**

```bash
git add vitepress-docs/docs/zh/guide/feature/public-link.md vitepress-docs/docs/en/guide/feature/public-link.md vitepress-docs/docs/.vitepress/zh.ts vitepress-docs/docs/.vitepress/en.ts
git commit -m "docs: add public link feature docs (zh/en)"
```

---

### Task 11: Bilingual CHANGELOGs

**Files:**
- Modify: `CHANGELOG.md` (under `## v1.11.0(main)` → `### Features`, after the existing feature bullets, before line 13's blank `### Bug Fixes`... insert in the Features section after line 24)
- Modify: `CHANGELOG_EN.md` (same position in its `v1.11.0(main)` Features section)

- [ ] **Step 1: Add entries to `CHANGELOG.md`** — in `### Features` of `v1.11.0(main)`:

```markdown
- feat: |Worker| 邮箱地址支持生成永久公开链接：新增地址级管理接口 `POST/GET/DELETE /api/public_link`（Bearer 地址 JWT），以及令牌只读接口 `GET /public_api/mails`（`x-public-token` 请求头，仅返回该地址邮件，不接受任意地址查询）；令牌为 10 位 Base62 安全随机串（约 83bit 熵），每地址同时仅一个生效链接，重新生成或撤销后旧令牌立即失效；删除/迁移地址时级联清理链接记录
- feat: |Frontend| 首页地址栏「复制」按钮旁新增「复制公开链接」（点击仅复制不跳转，首次点击自动生成）与「撤销公开链接」；新增公开邮箱只读页面 `/m/<token>`，复用现有邮件列表与渲染组件（无删除/回复/转发等写操作），链接失效或撤销时显示明确提示页
```

- [ ] **Step 2: Add entries to `CHANGELOG_EN.md`** — in its `### Features` section:

```markdown
- feat: |Worker| Mailbox addresses can now generate a permanent public link: address-scoped management endpoints `POST/GET/DELETE /api/public_link` (Bearer address JWT) plus a token-only read endpoint `GET /public_api/mails` (`x-public-token` header, returns only that address's mails, no arbitrary address lookup); tokens are 10-char Base62 CSPRNG strings (~83 bits of entropy), one active link per address, regenerating or revoking invalidates the old token immediately; address deletion/transfer cascades clean up link rows
- feat: |Frontend| Added "Copy Public Link" (click copies only, never navigates; auto-generates on first click) and "Revoke Public Link" next to the existing copy button in the address bar; new read-only public mailbox page at `/m/<token>` reusing the existing mail list/render components (no delete/reply/forward actions), with a clear "invalid or revoked link" state
```

- [ ] **Step 3: Verify**

Run: `git diff --stat` — confirm only the two changelog files changed; review the entries read correctly in both languages.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md CHANGELOG_EN.md
git commit -m "docs: update changelogs for public mail link feature"
```

---

## Self-Review Checklist

**Spec coverage:** Every spec section maps to a task: threat model → Task 1 (entropy) + Task 5 (rate limit, no-oracle 404, no `updateAddressUpdatedAt`, `x-custom-auth` exemption) + Task 7 (no-referrer) + Task 9 (read-only page assertions); token gen/storage → Tasks 1 & 2; endpoints → Tasks 4 & 5; error handling → Task 5 matrix + frontend states in Task 7; frontend behavior → Tasks 6–8; tests → Tasks 1, 3, 6, 9; CHANGELOG → Task 11; docs → Task 10.

**Placeholder scan:** No TBD/TODO/"add error handling" placeholders; every code step includes full code.

**Type consistency:** `isValidPublicToken`/`generatePublicToken` defined once (Task 1) and consumed in Tasks 4/5; `PublicLinkNotFoundMsg` added in Task 5 before the public API uses it (same task); table columns `address_id`/`token` consistent across Tasks 2, 4, 5, 7; `MailBox` props consistent with existing usages; i18n keys in Task 8 match the template strings in Task 7 (`views.PublicMail.*`) and handlers.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-04-public-mail-link.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
