# Private Mail Branding Design Spec

**Date:** 2026-08-04
**Status:** Approved requirements; implementation not started
**Implementation plan:** `docs/superpowers/plans/2026-08-04-private-mail-branding.md`

## 1. Overview

Rebrand the frontend as **私有邮箱** in Chinese and **Private Mail** in English while preserving existing application behavior and all backend/API/repository identifiers. The public mailbox route `/m/:token` becomes a standalone, content-only reading page. It must render only the mailbox address, mail list, selected mail content, refresh, pagination, and filtering controls. Normal routes keep their current product features, but use the neutral brand, neutral envelope-and-lock icon, updated PWA metadata, and updated footer.

This is a frontend presentation and route-shell change. No worker endpoint, database schema, API path, package name, repository name, or backend identifier is renamed.

## 2. Current Frontend Context

- `frontend/src/App.vue` currently wraps every route with `Header`, `Footer`, Naive UI providers, global loading, side margins, ads, and a back-to-top control.
- `frontend/src/views/PublicMail.vue` currently renders the public mailbox inside that global shell and calls `api.getOpenSettings()` for site branding.
- `frontend/src/views/Header.vue` owns the visible title, `/logo.png`, home/user/admin navigation, theme toggle, language selector, version/GitHub link, and page metadata.
- `frontend/src/views/Footer.vue` displays the localized copyright label plus configured copyright HTML.
- `frontend/src/i18n/message-registry.ts` is the en/zh source of truth; `frontend/src/i18n/locales/source/{de,es,ja,ptBR}.ts` supplies flat fallback messages.
- `frontend/index.html` and `frontend/vite.config.js` define static and generated PWA metadata, including the current temporary-email labels and logo asset.
- `frontend/src/components/MailBox.vue` already owns mail list, selected mail content, refresh, pagination, and filter behavior. The public page should continue to reuse it rather than duplicate those controls.

## 3. Requirements

### 3.1 Public mailbox route

For `/m/:token` and its existing localized alias `/:lang/m/:token`:

- Render no `Header`, `Footer`, logo, product name, home link, user link, admin link, theme toggle, language selector, version, GitHub/source link, ads, side margins, global navigation, or other global content.
- Render only the mailbox address, mail list, selected mail content, refresh, pagination, and filter controls, plus existing invalid-link/rate-limit/error states required to explain why content is unavailable.
- Keep the existing read-only restrictions: no delete, reply, forward, send, save-to-S3, or other mailbox mutation controls.
- Preserve the existing public token API flow and `MailBox`/`MailContentRenderer` rendering and sanitization behavior.
- Keep the existing route paths and token semantics unchanged.
- Keep `referrer=no-referrer` metadata on the public page.

### 3.2 Normal routes

All non-public routes retain their existing features and navigation behavior. Replace visible branding as follows:

- Chinese visible product name: `私有邮箱`.
- English visible product name: `Private Mail`.
- Replace the visible logo with a neutral envelope-plus-lock icon. The icon must not contain Cloudflare, temporary-email, repository, or author branding.
- Remove the visible GitHub/source link from desktop and mobile header actions.
- Remove all visible `Cloudflare Temp Email`, `Cloudflare 临时邮件`, temporary-email product-name variants, and equivalent visible branding from frontend UI and generated metadata.
- Do not rename backend/API/repository/package identifiers, internal URLs, source paths, or non-visible integration references.
- Preserve the existing user/admin/home navigation, theme toggle, language selector, status link, authentication controls, and feature pages.

### 3.3 Metadata and footer

- Update `frontend/index.html` title, description, Apple web-app title, favicon references, and related visible PWA metadata to use the Private Mail brand and neutral icon.
- Update the `vite-plugin-pwa` manifest values in `frontend/vite.config.js`, including `name`, `short_name`, `description`, and icon source/metadata.
- Ensure route-level `useHead` metadata does not reintroduce the old brand. Normal pages should use the localized Private Mail fallback; `/m/:token` should use content-only public-mail metadata without global branding.
- Update the footer's visible copyright/product wording to the localized Private Mail brand. Preserve configured administrator copyright content when it is intentionally supplied by the deployment, but do not add Cloudflare Temp Email branding as a fallback.

## 4. Design

### 4.1 Route-aware shell boundary

Keep the global providers in `App.vue`, but make the route shell conditional using the current route. The public route receives a minimal content frame; all other routes receive the existing grid, `Header`, route view, `Footer`, ads/side margins where enabled, and back-to-top behavior.

The minimal frame must not merely hide the header and footer with CSS. It must not mount global shell components or global content for the public route, preventing navigation, branding, metadata side effects, and global controls from entering the accessible tree.

The public page remains responsible for its own content layout and for invoking the existing `MailBox` component. The public page must not fetch or display `openSettings.title` as a product title.

### 4.2 Neutral icon

Use an existing Material icon component if it provides a clear envelope-plus-lock composition; otherwise add a small local Vue-rendered icon in the frontend presentation layer. The chosen icon must be accessible, have no brand-specific image text, and be used consistently by the normal header, favicon/PWA icon source, and Apple touch icon.

Do not rename `frontend/public/logo.png` or retain it as the visible header/favicon if it contains the old product branding. If a new neutral asset is needed, its exact path must be included in the implementation change and tests must verify the metadata points to it.

### 4.3 i18n

Add or replace only user-visible branding messages in the existing registry pattern:

| Key/context | English | Chinese |
|---|---|---|
| Normal product title | `Private Mail` | `私有邮箱` |
| Normal product description | `Private Mail` or an equivalent concise private-mail description | `私有邮箱` or an equivalent concise private-mail description |
| Footer brand fallback | `Private Mail` | `私有邮箱` |

Use the repository's existing additional-locale fallback convention for `de`, `es`, `ja`, and `pt-BR`: add flat keys where needed and use the English `Private Mail` fallback rather than leaving the old brand visible. Keep all existing message namespaces and locale switching behavior.

### 4.4 PWA and route metadata

Static HTML metadata and generated PWA metadata must agree on the localized/default product identity as far as static metadata allows. The public route can override its document title with a content-only title such as the localized public mailbox label, but must not include the normal product name, logo, or source link in page content.

## 5. Exact Implementation File Scope

The future implementation is expected to touch only these application/documentation files unless a test discovery proves an additional existing frontend test fixture is required:

**Modify**

- `frontend/src/App.vue` — route-aware shell mounting.
- `frontend/src/utils/private-mail-route.js` — pure public-route predicate shared by shell logic and tests.
- `frontend/src/views/PublicMail.vue` — content-only public layout and no global branding fetch/display.
- `frontend/src/views/Header.vue` — localized Private Mail title, neutral icon, removal of GitHub/source action, preserved normal-route controls.
- `frontend/src/views/Footer.vue` — localized Private Mail footer fallback.
- `frontend/src/views/common/About.vue` — remove the visible repository/source action while preserving the announcement and community action.
- `frontend/src/components/AddressCredentialModal.vue` — remove visible repository/source URLs from credential and agent guidance while preserving credential copying.
- `frontend/src/i18n/message-registry.ts` — en/zh branding messages.
- `frontend/src/i18n/locales/source/de.ts` — fallback branding messages.
- `frontend/src/i18n/locales/source/es.ts` — fallback branding messages.
- `frontend/src/i18n/locales/source/ja.ts` — fallback branding messages.
- `frontend/src/i18n/locales/source/ptBR.ts` — fallback branding messages.
- `frontend/index.html` — title, description, and icon/PWA metadata.
- `frontend/vite.config.js` — generated PWA manifest branding and icon metadata.
- `CHANGELOG.md` — Chinese entry under `v1.11.0(main)`.
- `CHANGELOG_EN.md` — English entry under `v1.11.0(main)`.

**Create**

- `frontend/public/private-mail-icon.svg` — neutral envelope-plus-lock asset used by the normal header and browser/PWA metadata.

**Tests**

- Add focused frontend unit coverage in `frontend/src/utils/__tests__/private-mail-branding.test.js`, following the existing Vitest test pattern.
- Add browser E2E coverage in `e2e/tests/browser/private-mail-branding.spec.ts`, using the existing browser fixture without altering backend/API test contracts.

No backend, database, API, repository, package-name, or route-identifier file is in scope.

## 6. Testing Strategy

### Unit/static checks

- Verify the branding registry resolves `私有邮箱` for `zh` and `Private Mail` for `en`.
- Verify the old visible product labels are absent from `frontend/index.html`, `frontend/vite.config.js`, `Header.vue`, `Footer.vue`, and the relevant i18n source entries.
- Verify the public route shell condition is true for `/m/<token>` and false for `/`, `/user`, and `/admin`.
- Verify `PublicMail.vue` continues to pass read-only props and filter/fetch behavior to `MailBox`.

### Browser acceptance checks

- Open `/m/<valid-token>` and assert the accessible page has mailbox address/mail content controls but no header, footer, product name, logo, navigation, theme, language, version, or GitHub/source link.
- Open a normal route in Chinese and assert `私有邮箱`, the neutral envelope-lock icon, normal navigation, theme toggle, and language selector are visible.
- Open a normal route in English and assert `Private Mail` and the same preserved controls are visible.
- Assert the GitHub/source link is absent from desktop and mobile header menus.
- Assert the public page remains read-only and can refresh, paginate, filter, select mail, and render mail content.
- Assert PWA metadata and footer use the new brand.

### Commands

Run from `frontend/`:

```bash
pnpm test
pnpm build
```

Run the targeted browser suite from `e2e/` when the Docker environment is available:

```bash
npm test -- tests/browser/private-mail-branding.spec.ts
```

The exact E2E filename may follow the repository's existing browser naming convention, but the test must cover the acceptance cases above and must not change API fixtures.

## 7. Acceptance Criteria

- `/m/:token` is a standalone content-only page and does not mount or expose the global header/footer shell.
- The public page contains only mailbox address, mail list, mail content, refresh, pagination, filter, and necessary error states.
- Public mail remains read-only and uses the existing mail fetching, pagination, filtering, parsing, and sanitization pipeline.
- Normal routes retain their existing features and controls.
- Visible Chinese branding is `私有邮箱`; visible English branding is `Private Mail`.
- The visible icon is a neutral envelope-plus-lock icon with no old brand imagery or text.
- GitHub/source links and all visible Cloudflare Temp Email branding are removed.
- PWA/static metadata and footer reflect the new branding.
- Backend/API/repository/package identifiers remain unchanged.
- `pnpm test` and `pnpm build` pass in `frontend/`.
- Browser acceptance coverage proves both public-shell isolation and normal-route branding preservation.
- Both changelogs are updated under `v1.11.0(main)` and no unrelated documentation is changed.

## 8. Changelog and Documentation

Add one concise feature or improvement entry to each current-version changelog:

- `CHANGELOG.md`: describe the Private Mail rebrand and content-only `/m/:token` public page in Chinese.
- `CHANGELOG_EN.md`: describe the same behavior in English.

No new API, environment variable, database migration, or deployment configuration is introduced, so VitePress feature/API documentation is not required. If the implementation adds a new asset or changes a documented deployment-visible PWA behavior, document only that concrete behavior in the relevant existing frontend deployment documentation.

## 9. Assumptions

- The requested date in both filenames is authoritative even though the repository's current HEAD may contain changes after that date.
- The localized alias `/:lang/m/:token` remains supported; it receives the same content-only shell as `/m/:token`.
- `openSettings` may still be used for non-brand operational settings, but its title/branding must not be displayed on the public page.
- Configured custom copyright text is deployment-owned content and is preserved unless it explicitly contains the old product branding; the default/fallback visible brand is changed to Private Mail.
- This documentation task must modify exactly the two requested documentation files and must not create a commit.
