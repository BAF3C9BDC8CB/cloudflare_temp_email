export const TOKEN_LENGTH = 10;

export const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const PUBLIC_TOKEN_RE = /^[0-9A-Za-z]{10}$/;

export const isValidPublicToken = (token: unknown): token is string =>
	typeof token === 'string' && PUBLIC_TOKEN_RE.test(token);

/** Generate a 10-character Base62 token without modulo bias. */
export const generatePublicToken = (): string => {
	const bytes = new Uint8Array(TOKEN_LENGTH);
	let token = '';
	while (token.length < TOKEN_LENGTH) {
		crypto.getRandomValues(bytes);
		for (const byte of bytes) {
			if (byte < 248) {
				token += BASE62[byte % 62];
				if (token.length >= TOKEN_LENGTH) break;
			}
		}
	}
	return token;
};
