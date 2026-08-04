# Public Mail Link — Design Spec

**Date:** 2026-08-04
**Status:** Approved (user-approved requirements)
**Feature branch intent:** No code changes from this document — it drives the implementation plan at `docs/superpowers/plans/2026-08-04-public-mail-link.md`.

## 1. Overview

Add a **public mail query page** to the temp-mail frontend. Each existing mailbox address can have **one permanent, revocable short public link** of the form `/m/<token>` (10-char Base62 token). Anyone with the link can view **only that mailbox's mails**, read-only. The owner creates, copies, and revokes the link from the address bar UI next to the existing copy-address control.

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ Owner browser (JWT session)  │        │ Visitor browser (no session) │
│  POST/GET/DELETE /api/public_link │        │  GET /m/<token>  (SPA route) │
│  └─ address-scoped (Bearer)  │        │  GET /public_api/mails       │
└──────────┬───────────────────┘        │     (x-public-token header)  │
           │                            └──────────────┬───────────────┘
           ▼                                           ▼
      ┌─────────────────── D1: address_public_link ──────────────────┐
      │  address_id (UNIQUE, FK→address.id)   token (UNIQUE, 10-B62) │
      └───────────────────────────────────────────────────────────────┘
```

## 2. Requirements (verbatim from user)

- Add a public mail query page.
- Each existing address gets a permanent, revocable short public link.
- Link token maps to exactly one address; **no arbitrary address lookup**; **no expiry**.
- Add a button near address management/copy controls that **copies** the public link (click = copy, not navigate).
- Short path such as `/m/<10-char Base62 token>`.
- Unbind/revoke immediately.
- Page lists and displays only that mailbox's mails, **reusing `MailBox`/`MailContentRenderer`** where appropriate.
- Deliverables must include: threat model, token generation/storage, endpoints, error handling, frontend behavior, tests, bilingual CHANGELOG updates, docs if needed.

## 3. Scope & Non-Goals

**In scope**
- DB table + auto-migration (`DB_INIT_QUERIES` + `CONSTANTS.DB_VERSION` bump + dated `db/` patch file).
- Address-scoped link management API (`POST/GET/DELETE /api/public_link`, address JWT auth).
- Public read-only mail list API (`GET /public_api/mails`, token auth via `x-public-token` header).
- Frontend public page (`/m/:token`) reusing `MailBox` + `MailContentRenderer`, read-only.
- Copy / revoke buttons in `AddressSelect.vue` (next to the existing copy-address button), plus a copy-public-link button in each row of the user address-management table after the unbind action.
- Worker + frontend i18n (en/zh + flat maps for de/es/ja/ptBR).
- E2E tests (API + browser), worker unit test (token), frontend unit test (helpers).
- Bilingual CHANGELOG + bilingual VitePress feature doc.

**Out of scope (YAGNI)**
- Expiry / TTL / password-protected links.
- Sending mail, deleting mail, replying, forwarding, or S3 download from the public page.
- Per-bound-address revoke UI in `AddressManagement.vue`; the table does include a copy-public-link action for each bound address.
- Admin-side link management.
- Listing an address's links in any existing list API.
- New environment variables / feature toggle.

## 4. Threat Model

### 4.1 Assets
- Mailbox contents (subject, body, headers, attachments) of any address that has a public link.
- The mailbox address string itself.
- Link ownership / revocability.

### 4.2 Adversaries
- **A1 — Random internet users:** brute-force the token.
- **A2 — Link recipients:** legitimate readers who may leak the link or use it after intended sharing ends.
- **A3 — Malicious referrer/tracker sites:** capture the token via `Referer` when the public page loads third-party content.
- **A4 — Server-side attacker with partial DB access:** read `address_public_link` rows.

### 4.3 Attacks & Mitigations

| # | Attack | Mitigation | Where |
|---|--------|-----------|-------|
| T1 | Brute-force token | 10-char Base62 = 62¹⁰ ≈ 8.4×10¹⁷ (~83 bits) entropy, CSPRNG-generated. Infeasible online. | `worker/src/public_api/token.ts` |
| T2 | Brute-force / abuse of the public endpoint | `/public_api/*` added to the global rate-limit block (per IP+path, same limiter as `new_address`/`send_mail`) + access-control (IP blacklist / daily limit). | `worker/src/worker.ts` |
| T3 | Arbitrary address lookup / enumeration | **No public endpoint accepts an address.** Public API only accepts a token; the token→address lookup is the only path. Malformed or unknown tokens both return the same 404 (no oracle). | `worker/src/public_api/index.ts` |
| T4 | Cross-address access | Token→address is 1:1 via the join; mail list query is scoped by the resolved address only. A token can never see another address's mails. | `worker/src/public_api/index.ts` |
| T5 | Revoked link keeps working | `DELETE /api/public_link` deletes the row immediately → subsequent reads 404. Regenerate deletes the old row first → old token invalidated. | `worker/src/mails_api/public_link.ts` |
| T6 | Token leakage via Referer / history / logs | Public page sets `referrer=no-referrer` meta (via `useHead`) so third-party resource loads don't leak the token; tokens never appear in public API URLs (they travel in the `x-public-token` header). Token in the page URL is inherent to the requirement — mitigated by one-click revocation. | `frontend/src/views/PublicMail.vue`, API header design |
| T7 | XSS from mail content on the public page | Reuse existing `MailContentRenderer` sanitization pipeline (`DOMPurify` + remote-content policy). Public page disables all write actions (`enableUserDeleteEmail=false`, `showReply=false`, `showSaveS3=false`). | `frontend/src/views/PublicMail.vue` |
| T8 | DoS via unbounded list | Reuse `handleMailListQuery` (limit capped 1–100, offset ≥ 0 validation). | `worker/src/common.ts` |
| T9 | Link views keep inactive address alive | Public reads deliberately do **not** call `updateAddressUpdatedAt` (unlike `/api/mails`), so link views don't reset the inactivity cleanup timer. | `worker/src/public_api/index.ts` |
| T10 | Stolen DB reveals tokens (A4) | Tokens stored **plaintext**. Accepted risk: the same DB already stores every mail's full raw content, so a DB leak is total mailbox compromise regardless; plaintext avoids the complexity of keyed hashing while preserving O(1) indexed lookup. Documented as an accepted trade-off. | `db/2026-08-04-public-link.sql` |
| T11 | `x-custom-auth` site password blocks the public page | `/public_api/*` is exempted from the `x-custom-auth` check (same as `/open_api`/`/telegram/`) — public sharing must work for visitors without the site password. | `worker/src/worker.ts` |
| T12 | Owner's browser sends its own JWT/custom-auth on public reads | Server ignores all auth except `x-public-token` on `/public_api/*` (no JWT middleware registered there). Harmless. | `worker/src/worker.ts` |

### 4.4 Accepted risks (explicit)
- Token is visible in the shared URL; anyone possessing it can read the mailbox until revoked. This is the feature's definition, mitigated by instant revocation.
- Tokens stored plaintext in D1 (T10 rationale above).

## 5. Data Model

New table (one link per address):

```sql
CREATE TABLE IF NOT EXISTS address_public_link (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address_id INTEGER UNIQUE NOT NULL,      -- FK → address.id
    token TEXT UNIQUE NOT NULL,              -- 10-char Base62, CSPRNG
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_address_public_link_token ON address_public_link(token);
```

- **1:1** — `address_id UNIQUE` ⇒ each address has at most one active link. Regenerating replaces the row (old token revoked).
- **No expiry column** — permanent by requirement.
- Applied via **three** mechanisms (repo convention):
  1. Dated patch `db/2026-08-04-public-link.sql` (record/manual apply),
  2. `DB_INIT_QUERIES` in `worker/src/admin_api/db_api.ts` (idempotent `CREATE TABLE IF NOT EXISTS`),
  3. `CONSTANTS.DB_VERSION` bumped `v0.0.7 → v0.0.8` so `POST /admin/db_migration` re-runs `DB_INIT_QUERIES`.

**Cascade cleanup** (must not orphan rows):
- `deleteAddressWithData` (`worker/src/common.ts`) — add `DELETE FROM address_public_link WHERE address_id = ?`.
- `batchDeleteAddressWithData` (`worker/src/common.ts`) — add subquery delete by `address_id IN (SELECT id FROM address WHERE <cond>)`.
- `transferAddress` (`worker/src/user_api/bind_address.ts`) — delete link row after the address row is deleted/re-created (address id changes).

## 6. Token Design

- **Charset:** `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz` (Base62, URL-safe, no lookalike issues).
- **Length:** 10 chars → 62¹⁰ ≈ 8.4×10¹⁷ (~83 bits).
- **Generation:** Web Crypto `crypto.getRandomValues(new Uint8Array(10))` with **rejection sampling** (reject bytes ≥ 248 = 62×4) to avoid modulo bias.
- **Validation regex:** `/^[0-9A-Za-z]{10}$/` — applied server-side before any SQL.
- **Collision handling:** `INSERT` retried up to 5× on the `token` UNIQUE constraint (astronomically unlikely).
- **Storage:** plaintext (see T10).
- Module: `worker/src/public_api/token.ts` (pure, unit-testable with `node --test` like `junk_mail_policy.test.mjs`).

## 7. API Contract

All endpoints JSON; errors are plain text (`c.text`) matching repo convention.

### 7.1 Link management (address JWT — existing `/api/*` jwt middleware)

**`POST /api/public_link`** — create or **regenerate** the link for the current address.
- Auth: `Authorization: Bearer <address_jwt>` (must contain `address` + `address_id`; address row must still exist).
- Response `200`: `{ "token": "<10-char>" }`
- Errors: `400` `InvalidAddressTokenMsg` (no address/address_id), `400` `InvalidAddressMsg` (address row gone), `500` on insert failure.

**`GET /api/public_link`** — read the current link (does **not** regenerate).
- Response `200`: `{ "token": "<10-char>" }` or `{ "token": null }` when none.

**`DELETE /api/public_link`** — revoke immediately (idempotent).
- Response `200`: `{ "success": true }` (even if no link existed).

### 7.2 Public read (token auth — no session)

**`GET /public_api/mails?limit=<1..100>&offset=<0..>`**
- Auth: `x-public-token: <token>` header.
- Response `200`: `{ "results": [...raw_mail rows, raw_blob resolved], "count": number, "address": "<address>" }`
  - `address` included so the page can show the mailbox name even with 0 mails.
  - Same row shape as `/api/mails` (compatible with frontend `processItem`).
  - Does **not** call `updateAddressUpdatedAt` (T9).
- Errors: `404` `PublicLinkNotFoundMsg` for missing/malformed/revoked/unknown token (indistinguishable). `400` for invalid limit/offset (from `handleMailListQuery`).

> No `GET /public_api/mail/:id` — `MailBox` renders detail client-side from the list; YAGNI.

## 8. Frontend Behavior

### 8.1 Routing
```js
{ path: '/m/:token', alias: '/:lang/m/:token', component: () => import('../views/PublicMail.vue') }
```
- `createWebHistory` + locale guard: `/m/<token>` first segment `m` is not a supported locale → passes through untouched. `/en/m/<token>` canonicalizes like other routes.
- SPA fallback already works: worker `ASSETS` serving rewrites non-dotted paths to `index.html`; Cloudflare Pages serves `index.html` for unmatched HTML routes.

### 8.2 Public page — `frontend/src/views/PublicMail.vue`
- Reads `route.params.token`.
- `useHead`: `title`, and `<meta name="referrer" content="no-referrer">` (T6).
- Fetches `/open_api/settings` for the site title/branding (uses existing `api.getOpenSettings`).
- `fetchMailData(limit, offset)` → `api.fetch('/public_api/mails?...', { headers: { 'x-public-token': token } })`, captures `res.address` for the header, returns `{results, count}` to `MailBox`.
  - On error: `/^\[404\]/` → "invalid or revoked link" state (`n-result`); `/^\[429\]/` → rate-limit state; else generic error.
- Renders `<MailBox :showEMailTo="true" :enableUserDeleteEmail="false" :showReply="false" :showSaveS3="false" :showFilterInput="true" :fetchMailData="fetchMailData" />` — read-only, reuses list + `MailContentRenderer` (desktop split view / mobile drawer, auto-refresh, pagination all inherited).
- **No** login / address-bar / send UI on this page.

### 8.3 Copy & revoke buttons — `frontend/src/components/AddressSelect.vue`
Rendered next to the existing copy-address button, **only when `showCopy` is true** (so the minimal `SimpleIndex` stays clean).
- **Copy public link** (`copyPublicLink`):
  1. `GET /api/public_link` → `{ token }`.
  2. If `token` null → `POST /api/public_link` to create it (GET-then-POST ensures copy never rotates an already-shared link).
  3. `toClipboard(window.location.origin + router.resolve({ path: '/m/' + token }).href)`.
  4. Success message `publicLinkCopied`. Click **copies only** — no navigation.
- **Revoke public link** (`revokePublicLink`, wrapped in `n-popconfirm` with `publicLinkRevokeTip`):
  1. `DELETE /api/public_link`.
   2. Success message `publicLinkRevoked`. The shared URL 404s immediately (server-side, no caching involved).

### 8.4 Copy button — `frontend/src/views/user/AddressManagement.vue`

- Add a `copyPublicLink(row)` action immediately after the existing unbind action in each address row.
- The row action obtains an address JWT through the existing `/user_api/bind_address_jwt/:address_id` endpoint, then calls the address-scoped `GET /api/public_link` with that JWT. If no link exists, it calls `POST /api/public_link` with the same JWT.
- Build the same short `/m/<token>` URL and copy it to the clipboard; clicking this action never navigates and never changes the currently active address.
- A failed JWT lookup, missing address, or clipboard failure displays the existing table error toast and leaves the row unchanged.

### 8.5 API client change — `frontend/src/api/index.js`
`apiFetch` currently ignores `options.headers`; merge them so the public page can send `x-public-token`:
```js
if (options.headers) Object.assign(headers, options.headers);
```
(Additive; existing callers unaffected.)

## 9. Error Handling Matrix

| Case | Status | Message | Shown as |
|------|--------|---------|----------|
| No/malformed/unknown/revoked token on public read | 404 | `PublicLinkNotFoundMsg` | Public page "invalid or revoked" state |
| Token brute-force | 429 | rate-limit text | Public page rate-limit state |
| `POST /api/public_link` without valid address token | 400 | `InvalidAddressTokenMsg` | toast error |
| `POST /api/public_link` with deleted address | 400 | `InvalidAddressMsg` | toast error |
| invalid `limit`/`offset` | 400 | `InvalidLimitMsg`/`InvalidOffsetMsg` | toast error |
| DB failure | 500 | error text | toast / generic |

## 10. i18n

- **Worker:** add `PublicLinkNotFoundMsg` to `worker/src/i18n/{type,zh,en}.ts`.
  - zh: `公开链接不存在或已被撤销` / en: `Public link not found or revoked`.
- **Frontend** (`frontend/src/i18n/message-registry.ts` — source of truth en/zh):
  - `components.AddressSelect`: `copyPublicLink`, `revokePublicLink`, `publicLinkRevokeTip`, `publicLinkCopied`, `publicLinkRevoked`.
  - `views.PublicMail` (new namespace): `publicMailbox`, `invalidLink`, `invalidLinkTip`, `address`.
- **Additional locales** (`frontend/src/i18n/locales/source/{de,es,ja,ptBR}.ts`): add flat keys with English text (repo convention when translations are pending; missing keys fall back to en without breaking the build).

## 11. Testing Strategy

| Layer | What | Where / command |
|-------|------|-----------------|
| Worker unit | Token format/entropy/validation | `worker/src/public_api/token.test.mjs` — `node --test worker/src/public_api/token.test.mjs` (Node 24, same pattern as `junk_mail_policy.test.mjs`) |
| Frontend unit | `isValidPublicToken` / `buildPublicLinkUrl` | `frontend/src/utils/__tests__/public-link.test.js` — `pnpm test` (vitest) |
| E2E API | create → seed mail → list via token → scoping → regenerate invalidates old → revoke → delete-address cleanup → malformed/missing token | `e2e/tests/api/public-link.spec.ts` |
| E2E browser | navigate `/m/<token>` shows the mailbox & mail detail; copy button copies `${origin}/m/<token>` to clipboard | `e2e/tests/browser/public-link.spec.ts` |

Targeted e2e loop (see plan for exact commands):
```bash
cd e2e && docker compose up -d --build
docker compose run --rm e2e-runner npx playwright test tests/api/public-link.spec.ts --project=api
docker compose down -v
```

## 12. Docs & Changelog

- New feature docs: `vitepress-docs/docs/zh/guide/feature/public-link.md` + `.../en/guide/feature/public-link.md` (what/why, UI steps, API reference, security notes).
- Sidebar entries in `vitepress-docs/docs/.vitepress/{zh,en}.ts` under **API 接口 / API Endpoints** (after `delete-address`).
- `CHANGELOG.md` + `CHANGELOG_EN.md` under `v1.11.0(main)` → Features: one |Frontend| entry, one |Worker| entry.
- No new env vars → `worker-vars.md` untouched.

## 13. Files

**Create**
- `db/2026-08-04-public-link.sql`
- `worker/src/public_api/token.ts`
- `worker/src/public_api/token.test.mjs`
- `worker/src/public_api/index.ts`
- `worker/src/mails_api/public_link.ts`
- `frontend/src/views/PublicMail.vue`
- `frontend/src/views/user/AddressManagement.vue`
- `frontend/src/utils/public-link.js`
- `frontend/src/utils/__tests__/public-link.test.js`
- `e2e/tests/api/public-link.spec.ts`
- `e2e/tests/browser/public-link.spec.ts`
- `vitepress-docs/docs/zh/guide/feature/public-link.md`
- `vitepress-docs/docs/en/guide/feature/public-link.md`

**Modify**
- `worker/src/worker.ts` (route mount, API_PATHS, x-custom-auth exemption, rate limit)
- `worker/src/mails_api/index.ts` (register link routes)
- `worker/src/common.ts` (delete cascade ×2)
- `worker/src/user_api/bind_address.ts` (transfer cascade)
- `worker/src/admin_api/db_api.ts` (DB_INIT_QUERIES)
- `worker/src/constants.ts` (DB_VERSION)
- `worker/src/i18n/type.ts`, `worker/src/i18n/zh.ts`, `worker/src/i18n/en.ts`
- `pages/functions/_middleware.js` (route `/public_api/` to worker)
- `e2e/Dockerfile.frontend` (vite proxy for `/public_api`)
- `frontend/src/router/index.js`
- `frontend/src/components/AddressSelect.vue`
- `frontend/src/api/index.js`
- `frontend/src/i18n/message-registry.ts`
- `frontend/src/i18n/locales/source/{de,es,ja,ptBR}.ts`
- `vitepress-docs/docs/.vitepress/zh.ts`, `vitepress-docs/docs/.vitepress/en.ts`
- `CHANGELOG.md`, `CHANGELOG_EN.md`

## 14. Rollout / Migration

1. Deploy worker → `POST /admin/db_migration` (admin console "数据库迁移" button) auto-creates the table via `DB_INIT_QUERIES` + `DB_VERSION` bump. Dated `db/*.sql` available for manual `wrangler d1 execute`.
2. Deploy frontend (Pages) — new route + buttons live.
3. No data migration; links are created on demand.
