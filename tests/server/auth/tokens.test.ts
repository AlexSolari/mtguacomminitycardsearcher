import { describe, expect, test } from 'bun:test';
import { codeChallenge, randomToken, tokenHash } from '@/server/auth/tokens';

describe('tokens', () => {
    test('randomToken: base64url of the given number of bytes, different each time', () => {
        expect(randomToken()).toMatch(/^[\w-]{43}$/);
        expect(randomToken(16)).toMatch(/^[\w-]{22}$/);
        expect(randomToken()).not.toBe(randomToken());
    });

    test('tokenHash: sha256 in hex', () => {
        expect(tokenHash('abc')).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        );
    });

    // RFC 7636, appendix B
    test('codeChallenge: the S256 challenge', () => {
        expect(
            codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
        ).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });
});
