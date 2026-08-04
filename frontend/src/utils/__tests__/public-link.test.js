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
