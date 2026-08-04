# Private Mail Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the frontend as 私有邮箱 / Private Mail and isolate `/m/:token` as a content-only public mailbox page without changing backend, API, repository, or package identifiers.

**Architecture:** Keep Naive UI, Vue Router, Vue I18n, `MailBox`, and the existing API flow. Make `App.vue` choose between the existing normal shell and a minimal public-route shell; update visible branding and metadata in the existing header, footer, i18n, HTML, and PWA configuration files. The public route must not mount global shell components, while normal routes continue to mount all current features.

**Tech Stack:** Vue 3, Vue Router 4, Naive UI, Vue I18n 11, `@unhead/vue`, Vite, `vite-plugin-pwa`, Vitest, Playwright, existing frontend/e2e fixtures.

## Global Constraints

- `/m/:token` and `/:lang/m/:token` are standalone content-only routes with no `Header`, `Footer`, logo, product name, home/user/admin links, theme toggle, language selector, version, GitHub/source link, ads, or other global content.
- The public route retains only mailbox address, mail list, mail content, refresh, pagination, filter, and necessary error states.
- Normal routes retain their existing features and controls.
- Visible Chinese product name is exactly `私有邮箱`; visible English product name is exactly `Private Mail`.
- The visible logo is a neutral envelope-plus-lock icon with no Cloudflare, temporary-email, repository, or author branding.
- Remove visible GitHub/source links and all visible Cloudflare Temp Email branding.
- Update static HTML metadata, generated PWA metadata, icon references, and footer branding.
- Do not rename backend/API/repository/package identifiers, API paths, internal source identifiers, or integration URLs.
- Follow existing Vue/Naive UI/i18n patterns and preserve the existing public mail read-only props and sanitization pipeline.
- This plan does not include a commit; the implementation worker must not rename unrelated files or modify backend/API files.

---

## File Map

**Modify:**

- `frontend/src/App.vue` — choose normal or minimal shell from the current route.
- `frontend/src/utils/private-mail-route.js` — pure public-route predicate shared by shell logic and tests.
- `frontend/src/views/PublicMail.vue` — keep only public mailbox content and public error states.
- `frontend/src/views/Header.vue` — update title/icon, remove GitHub/source actions, preserve normal controls.
- `frontend/src/views/Footer.vue` — update the visible fallback brand.
- `frontend/src/views/common/About.vue` — remove the visible repository/source action while preserving announcement/community content.
- `frontend/src/components/AddressCredentialModal.vue` — remove visible repository/source URLs while preserving credential features.
- `frontend/src/i18n/message-registry.ts` — define en/zh Private Mail branding.
- `frontend/src/i18n/locales/source/de.ts` — add fallback branding strings.
- `frontend/src/i18n/locales/source/es.ts` — add fallback branding strings.
- `frontend/src/i18n/locales/source/ja.ts` — add fallback branding strings.
- `frontend/src/i18n/locales/source/ptBR.ts` — add fallback branding strings.
- `frontend/index.html` — update static title, description, app title, and icon metadata.
- `frontend/vite.config.js` — update generated PWA manifest values and icon source.
- `CHANGELOG.md` — add the Chinese current-version entry.
- `CHANGELOG_EN.md` — add the English current-version entry.

**Create:**

- `frontend/public/private-mail-icon.svg` — neutral envelope-plus-lock asset used by the normal header and browser/PWA metadata.

**Tests:**

- Use `frontend/src/utils/__tests__/private-mail-branding.test.js` for focused Vitest assertions.
- Use `e2e/tests/browser/private-mail-branding.spec.ts` for browser acceptance assertions.

## Task 1: Add failing shell-isolation and branding tests

**Files:**

- Create: `frontend/src/utils/__tests__/private-mail-branding.test.js`
- Create: `e2e/tests/browser/private-mail-branding.spec.ts`

**Interfaces:**

- Consumes: current router paths, `App.vue` shell behavior, i18n registry, and `PublicMail.vue` props.
- Produces: failing tests that define public shell isolation and normal-route branding behavior.

- [ ] **Step 1: Write the failing unit/static assertions**

Assert these exact behaviors using the repository's current Vitest setup or source-level assertions if mounting `App.vue` requires unavailable app plugins:

```js
it('treats the public mailbox paths as content-only routes', () => {
    expect(isPublicMailRoute({ path: '/m/Ab3xY9zKq2' })).toBe(true)
    expect(isPublicMailRoute({ path: '/en/m/Ab3xY9zKq2' })).toBe(true)
    expect(isPublicMailRoute({ path: '/' })).toBe(false)
    expect(isPublicMailRoute({ path: '/user' })).toBe(false)
})

it('uses the requested visible brand', () => {
    expect(messages.en.views.Header.title).toBe('Private Mail')
    expect(messages.zh.views.Header.title).toBe('私有邮箱')
})
```

The test should assert the route predicate through the exported pure helper `isPublicMailRoute(path)` defined in `frontend/src/utils/private-mail-route.js`; this keeps route classification independently testable without mounting the full application.

- [ ] **Step 2: Write the failing browser assertions**

Use the existing browser fixture and a valid public-link/mail setup. The public page assertions must include:

```ts
await page.goto(`${FRONTEND_URL}/m/${token}`)
await expect(page.getByText(address)).toBeVisible()
await expect(page.getByText('Private Mail')).toHaveCount(0)
await expect(page.locator('header')).toHaveCount(0)
await expect(page.getByRole('link', { name: /github|source/i })).toHaveCount(0)
```

The normal-route assertions must navigate to `/en/` and `/zh/`, verify `Private Mail`/`私有邮箱`, verify the neutral icon, and verify that navigation, theme, and language controls remain available.

- [ ] **Step 3: Run the focused tests and confirm red**

Run from `frontend/`:

```bash
pnpm test -- private-mail-branding
```

Run the browser test when the e2e environment is available:

```bash
cd ../e2e
npm test -- tests/browser/private-mail-branding.spec.ts
```

Expected result: the new assertions fail because the current app mounts the global shell on every route and still exposes the old branding.

## Task 2: Implement route-aware shell isolation

**Files:**

- Modify: `frontend/src/App.vue`
- Create: `frontend/src/utils/private-mail-route.js`
- Modify: `frontend/src/views/PublicMail.vue`

**Interfaces:**

- Consumes: `useRoute()`, the existing `MailBox` component, current public token API flow, and Naive UI providers.
- Produces: a minimal public route shell that mounts no global chrome and a normal shell that preserves current layout behavior.

- [ ] **Step 1: Add the shared route predicate**

Create `frontend/src/utils/private-mail-route.js` with a pure predicate that accepts a pathname string and matches both public forms without changing router paths:

```js
export const isPublicMailRoute = (path) =>
    /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?m\/[^/]+$/.test(path)
```

Import this helper in `App.vue`, then derive the reactive state from the current route:

```js
const route = useRoute()
const isPublicMailRoute = computed(() => isPublicMailRoutePath(route.path))
```

Import the helper as `isPublicMailRoutePath` to avoid shadowing the computed ref:

```js
import { isPublicMailRoute as isPublicMailRoutePath } from './utils/private-mail-route'
```

Keep `n-config-provider`, global style, loading, notification, and message providers outside the route branch so existing Naive UI behavior remains available to `PublicMail.vue`. Do not mount ads, side margins, `Header`, `Footer`, or `n-back-top` in the public branch.

- [ ] **Step 2: Split the template into minimal and normal branches**

Render `<router-view />` directly in a minimal content wrapper when `isPublicMailRoute` is true. Put the current grid/layout/header/footer/back-top structure behind `v-else`, preserving existing computed columns and side-ad behavior for normal routes.

- [ ] **Step 3: Remove public-page global branding dependencies**

In `PublicMail.vue`, keep `useHead` referrer protection, token validation, public API fetch, error states, and `MailBox` props. Remove the `openSettings` title from the public header. Display only the mailbox address already returned by the public API; if a title label is needed for accessibility, use a scoped public-mail i18n message rather than the product name. Keep these exact read-only props:

```vue
<MailBox
    :showEMailTo="true"
    :enableUserDeleteEmail="false"
    :showReply="false"
    :showSaveS3="false"
    :showFilterInput="true"
    :fetchMailData="fetchMailData"
/>
```

- [ ] **Step 4: Run focused tests and verify green**

```bash
cd frontend
pnpm test -- private-mail-branding
```

Expected result: route-shell and public content assertions pass, while branding assertions may remain red until Task 3.

## Task 3: Replace normal-route visible branding and remove source links

**Files:**

- Modify: `frontend/src/views/Header.vue`
- Modify: `frontend/src/views/Footer.vue`
- Modify: `frontend/src/i18n/message-registry.ts`
- Modify: `frontend/src/i18n/locales/source/de.ts`
- Modify: `frontend/src/i18n/locales/source/es.ts`
- Modify: `frontend/src/i18n/locales/source/ja.ts`
- Modify: `frontend/src/i18n/locales/source/ptBR.ts`

**Interfaces:**

- Consumes: existing `views.Header`/`views.Footer` scoped i18n namespaces and normal-route controls.
- Produces: localized Private Mail visible branding with GitHub/source actions removed.

- [ ] **Step 1: Replace source-of-truth en/zh branding messages**

Change the existing header title and footer brand fallback messages to exactly:

```ts
title: {
    en: 'Private Mail',
    zh: '私有邮箱',
},
```

Keep message keys and namespaces stable so all existing callers continue to work. Add a dedicated footer brand key only if the current footer key cannot represent the new fallback without displaying the old text.

- [ ] **Step 2: Add additional-locale fallback entries**

Add flat entries to each additional locale source using the existing fallback convention:

```ts
'views.Header.title': 'Private Mail',
```

Add the corresponding footer key if introduced. Do not translate or rename unrelated message keys.

- [ ] **Step 3: Update the header presentation**

Keep home/user/admin/status navigation, theme toggle, language selector, authentication controls, and mobile menu. Remove both desktop and mobile GitHub/source action blocks and their imports/computed visibility logic. Replace the avatar image with the neutral envelope-lock icon while preserving the existing admin-entry click behavior only if it remains a normal-route feature without visible old branding.

- [ ] **Step 4: Update the footer presentation**

Preserve the configured `openSettings.copyright` content and existing sanitized rendering. Replace the default visible product/copyright label with the localized Private Mail message and ensure no fallback path emits the old product name.

- [ ] **Step 5: Run i18n/build checks**

```bash
cd frontend
pnpm test -- private-mail-branding
pnpm build
```

Expected result: localized branding assertions pass and the normal frontend build succeeds.

## Task 4: Replace the visible icon and update static/PWA metadata

**Files:**

- Modify: `frontend/index.html`
- Modify: `frontend/vite.config.js`
- Modify: `frontend/src/views/Header.vue` if the icon component reference is changed
- Create: `frontend/public/private-mail-icon.svg`

**Interfaces:**

- Consumes: the selected neutral envelope-plus-lock icon/asset.
- Produces: consistent neutral icon and Private Mail metadata for browser tabs, install prompts, and PWA manifests.

- [ ] **Step 1: Create the neutral icon asset**

Create `frontend/public/private-mail-icon.svg` as a text-free neutral envelope-plus-lock icon, then use that exact path consistently for the normal header avatar/icon and browser/PWA metadata. The SVG must contain no Cloudflare, temporary-email, repository, author, or other brand text.

- [ ] **Step 2: Update `frontend/index.html` metadata**

Set the static values to the new English fallback brand:

```html
<title>Private Mail</title>
<meta name="description" content="Private Mail">
<meta name="apple-mobile-web-app-title" content="Private Mail">
```

Point favicon and Apple touch icon references at the neutral icon asset/component output. Keep viewport, theme-color, Turnstile, and application bootstrap behavior unchanged.

- [ ] **Step 3: Update the PWA manifest configuration**

In `frontend/vite.config.js`, change generated `name`, `short_name`, and `description` values to Private Mail and point `icons[].src` at the neutral icon asset. Keep existing PWA enable/disable environment behavior and icon sizes/types valid for `vite-plugin-pwa`.

- [ ] **Step 4: Verify generated output**

```bash
cd frontend
pnpm build
```

Inspect `frontend/dist/index.html` and generated manifest output for `Private Mail`, the neutral icon path, and absence of the old visible brand. Do not treat internal source-map/package identifiers as visible-brand failures.

## Task 5: Add regression coverage for public controls and normal controls

**Files:**

- Modify: `frontend/src/utils/__tests__/private-mail-branding.test.js`
- Modify: `e2e/tests/browser/private-mail-branding.spec.ts`

**Interfaces:**

- Consumes: completed shell, branding, and metadata implementation.
- Produces: acceptance coverage for content-only public mail and preserved normal-route features.

- [ ] **Step 1: Assert public content-only behavior**

The browser test must open a valid public token and assert:

```ts
await expect(page.getByText(address)).toBeVisible()
await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible()
await expect(page.getByRole('button', { name: /filter/i })).toBeVisible()
await expect(page.getByRole('navigation')).toHaveCount(0)
await expect(page.locator('footer')).toHaveCount(0)
await expect(page.getByText(/Private Mail|私有邮箱/)).toHaveCount(0)
await expect(page.getByRole('link', { name: /github|source/i })).toHaveCount(0)
```

Also select a mail, verify its content renders, change pagination/filter state, and confirm no delete/reply/forward/save action is exposed.

- [ ] **Step 2: Assert normal-route behavior**

Navigate to `/en/` and `/zh/` and verify:

```ts
await expect(page.getByText('Private Mail')).toBeVisible()
await page.goto(`${FRONTEND_URL}/zh/`)
await expect(page.getByText('私有邮箱')).toBeVisible()
await expect(page.getByRole('button', { name: /menu|language/i })).toBeVisible()
```

Use selectors matching the actual existing accessible labels. Verify home/user/admin links and theme/language controls remain available where their existing visibility rules permit them. Verify no GitHub/source link exists in desktop or mobile menus.

- [ ] **Step 3: Assert metadata**

Check `document.title`, the description meta tag, Apple web-app title, manifest fields, and icon href. The default/static values must be Private Mail and the neutral icon path.

- [ ] **Step 4: Run all frontend checks**

```bash
cd frontend
pnpm test
pnpm build
```

Then run the targeted browser test:

```bash
cd ../e2e
npm test -- tests/browser/private-mail-branding.spec.ts
```

Expected result: all unit/build/browser checks pass.

## Task 6: Update bilingual changelogs and perform final review

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG_EN.md`

**Interfaces:**

- Consumes: completed frontend behavior and passing tests.
- Produces: current-version release notes in both languages with no code or API claims beyond the implemented scope.

- [ ] **Step 1: Add the Chinese entry under `v1.11.0(main)`**

Add under `### Features` or `### Improvements`:

```markdown
- feat: |Frontend| 品牌更新为「私有邮箱」，普通页面使用中性信封锁图标并移除可见 GitHub/旧品牌信息；`/m/:token` 改为仅展示邮箱地址、邮件列表与邮件内容及刷新、分页、筛选操作的独立只读页面，同时更新 PWA 元数据和页脚
```

- [ ] **Step 2: Add the English entry under `v1.11.0(main)`**

Add the corresponding English entry:

```markdown
- feat: |Frontend| Rebrand the visible UI as Private Mail with a neutral envelope-lock icon and no visible GitHub/old product branding; make `/m/:token` a standalone read-only page containing only the mailbox address, mail list/content, refresh, pagination, and filtering controls, and update PWA metadata and footer branding
```

- [ ] **Step 3: Review scope and identifiers**

Run:

```bash
git status --short
```

Confirm no backend/API/repository/package identifier was renamed, no unrelated file changed, and only the intended implementation files plus the two changelogs are present in the final diff. The implementation worker must not commit.

## Acceptance Checklist

- [ ] `/m/:token` mounts no global header/footer shell.
- [ ] Public page exposes only address, list, content, refresh, pagination, filter, and necessary error states.
- [ ] Public page remains read-only and reuses existing `MailBox`/`MailContentRenderer` behavior.
- [ ] Normal routes retain navigation, theme, language, authentication, and existing feature controls.
- [ ] Visible en/zh brand is exactly `Private Mail` / `私有邮箱`.
- [ ] Neutral envelope-lock icon is used consistently and contains no old brand.
- [ ] GitHub/source links and visible Cloudflare Temp Email branding are absent.
- [ ] Static and generated PWA metadata and footer use the new brand.
- [ ] Backend/API/repository/package identifiers are unchanged.
- [ ] `pnpm test` passes.
- [ ] `pnpm build` passes.
- [ ] Browser acceptance coverage passes for public isolation and normal-route preservation.
- [ ] Both current-version changelogs are updated.
