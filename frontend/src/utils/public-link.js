export const PUBLIC_TOKEN_RE = /^[0-9A-Za-z]{10}$/

export const isValidPublicToken = (token) =>
    typeof token === 'string' && PUBLIC_TOKEN_RE.test(token)

export const buildPublicLinkUrl = (token) =>
    isValidPublicToken(token) ? `/m/${token}` : ''
