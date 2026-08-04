import assert from 'node:assert/strict';
import test from 'node:test';

import {
	generatePublicToken,
	isValidPublicToken,
	PUBLIC_TOKEN_RE,
	TOKEN_LENGTH,
} from './token.ts';

test('generated tokens are TOKEN_LENGTH-char base62', () => {
	assert.equal(TOKEN_LENGTH, 10);
	for (let i = 0; i < 100; i++) {
		const token = generatePublicToken();
		assert.equal(token.length, TOKEN_LENGTH);
		assert.match(token, PUBLIC_TOKEN_RE);
	}
});

test('tokens are not trivially repeated', () => {
	const seen = new Set();
	for (let i = 0; i < 500; i++) {
		seen.add(generatePublicToken());
	}
	assert.ok(seen.size > 400, `only ${seen.size} unique tokens in 500`);
});

test('isValidPublicToken rejects malformed input', () => {
	assert.equal(isValidPublicToken(null), false);
	assert.equal(isValidPublicToken(undefined), false);
	assert.equal(isValidPublicToken(''), false);
	assert.equal(isValidPublicToken('short'), false);
	assert.equal(isValidPublicToken('a'.repeat(11)), false);
	assert.equal(isValidPublicToken('!'.repeat(10)), false);
	assert.equal(isValidPublicToken('0Ab9ZzXy12'), true);
});
