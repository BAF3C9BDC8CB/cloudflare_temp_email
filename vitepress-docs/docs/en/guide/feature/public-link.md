# Public Link

A mailbox address can generate a **permanent, instantly revocable** short link. Anyone with the link can view that mailbox in read-only mode.

- Link format: `/m/<10-character Base62 random token>`
- Only one active link exists per address; regeneration invalidates the old token immediately
- Links do not expire, but revocation takes effect immediately

## Usage

1. Click **Copy Public Link** in the address bar or user mailbox list. The first click creates the link if needed.
2. Share the link; recipients can view the mailbox without logging in.
3. Click **Revoke Public Link** and confirm to stop sharing immediately.

## API Reference

Management endpoints require `Authorization: Bearer <jwt>`:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/public_link` | Create or regenerate the link |
| `GET` | `/api/public_link` | Read the current link, or `token: null` |
| `DELETE` | `/api/public_link` | Revoke the link |

The public endpoint uses `x-public-token: <token>`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/public_api/mails?limit=&offset=` | Paginated mails for that token's mailbox |

Missing, malformed, revoked, and unknown tokens all return `404`. Public requests accept tokens only and are rate limited.

## Security

Tokens are generated with Web Crypto as 10-character Base62 CSPRNG values. The public page has no delete, reply, forward, or download write actions.
