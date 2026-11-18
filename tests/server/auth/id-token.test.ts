import { beforeAll, describe, expect, test } from 'bun:test';
import {
    IdTokenError,
    Jwks,
    verifyIdToken,
    type Jwk
} from '@/server/auth/id-token';
import { ShopClient } from '@/server/shop-client';
import { signingKey } from './signing-keys';

const expected = { issuer: 'https://oauth.telegram.org', audience: '123456' };
const NOW = 1_700_000_000_000;
const claims = {
    iss: 'https://oauth.telegram.org',
    aud: '123456',
    sub: 'abc',
    iat: NOW / 1000,
    exp: NOW / 1000 + 3600,
    id: 987654321
};

describe('verifyIdToken', () => {
    let rsa: Awaited<ReturnType<typeof signingKey>>;
    let ec: Awaited<ReturnType<typeof signingKey>>;
    let other: Awaited<ReturnType<typeof signingKey>>;
    let keys: Jwk[];
    beforeAll(async () => {
        rsa = await signingKey('RS256', 'oidc-1');
        ec = await signingKey('ES256', 'oidc-2');
        other = await signingKey('RS256', 'oidc-1'); // same kid, different key: a forgery
        keys = [rsa.jwk, ec.jwk];
    });
    const verify = (token: string, now = NOW, jwks = keys) =>
        verifyIdToken(token, async () => jwks, expected, now);
    const rejects = async (
        token: Promise<string> | string,
        message: string,
        now = NOW
    ) => {
        const error = await verify(await token, now).catch((e) => e);
        expect(error).toBeInstanceOf(IdTokenError);
        expect(error.message).toBe(message);
    };

    test('RS256 and ES256 tokens from a published key pass, with their claims', async () => {
        expect(await verify(await rsa.sign(claims))).toEqual(claims);
        expect(await verify(await ec.sign(claims))).toEqual(claims);
    });

    test('the key is picked by kid; without one, any key of the algorithm will do', async () => {
        const token = await rsa.sign(claims, { kid: undefined });
        expect(await verify(token)).toEqual(claims);
        await rejects(rsa.sign(claims, { kid: 'unknown' }), 'no matching key');
        // the EC key alone can't check an RS256 token
        expect(
            await verifyIdToken(
                await rsa.sign(claims, { kid: undefined }),
                async () => [ec.jwk],
                expected,
                NOW
            ).catch((e) => e.message)
        ).toBe('no matching key');
    });

    test("a key that doesn't fit the algorithm fails the check, not the server", async () => {
        const mislabelled = { ...ec.jwk, kid: 'oidc-1', alg: undefined };
        expect(
            await verifyIdToken(
                await rsa.sign(claims),
                async () => [mislabelled],
                expected,
                NOW
            ).catch((e) => e.message)
        ).toBe('invalid signature');
    });

    test('a forged or altered token is refused', async () => {
        await rejects(other.sign(claims), 'invalid signature');
        const [head, , sig] = (await rsa.sign(claims)).split('.');
        const altered = Buffer.from(
            JSON.stringify({ ...claims, id: 1 })
        ).toString('base64url');
        await rejects(`${head}.${altered}.${sig}`, 'invalid signature');
    });

    test('only RS256 and ES256 are accepted', async () => {
        await rejects(
            rsa.sign(claims, { alg: 'none' }),
            'unsupported algorithm: none'
        );
        await rejects(
            rsa.sign(claims, { alg: 'HS256' }),
            'unsupported algorithm: HS256'
        );
    });

    test('issuer, audience and expiry must match', async () => {
        await rejects(
            rsa.sign({ ...claims, iss: 'https://evil.example' }),
            'wrong issuer'
        );
        await rejects(rsa.sign({ ...claims, aud: '654321' }), 'wrong audience');
        expect(
            await verify(await rsa.sign({ ...claims, aud: ['x', 123456] }))
        ).toBeTruthy();
        await rejects(rsa.sign({ ...claims, exp: undefined }), 'token expired');
        // a minute of clock difference is allowed
        const exp = claims.exp * 1000;
        expect(await verify(await rsa.sign(claims), exp + 59_000)).toBeTruthy();
        await rejects(rsa.sign(claims), 'token expired', exp + 60_000);
    });

    test('malformed tokens are refused', async () => {
        await rejects('a.b', 'malformed token');
        await rejects('!!!.e30.sig', 'malformed token');
        const head = Buffer.from('{"alg":"RS256"}').toString('base64url');
        await rejects(
            `${head}.${Buffer.from('null').toString('base64url')}.x`,
            'malformed token'
        );
        await rejects(
            `${head}.${Buffer.from('"text"').toString('base64url')}.x`,
            'malformed token'
        );
        await rejects(
            `${Buffer.from('null').toString('base64url')}.e30.x`,
            'unsupported algorithm: undefined'
        );
    });
});

describe('Jwks', () => {
    const base = 'https://oauth.telegram.org';
    const url = `${base}/.well-known/jwks.json`;
    function fakeClient(answers: unknown[]) {
        const requests: string[] = [];
        const client = {
            url: new ShopClient(base).url.bind(new ShopClient(base)),
            fetchJson: async (u: string) => {
                requests.push(u);
                return answers.shift();
            }
        } as unknown as ShopClient;
        return { client, requests };
    }
    const keys = (...kids: string[]) => ({
        keys: kids.map((kid) => ({ kid }))
    });

    test('fetched when first needed, then kept until it ages out', async () => {
        let now = 0;
        const { client, requests } = fakeClient([keys('a'), keys('b')]);
        const jwks = new Jwks(
            client,
            '/.well-known/jwks.json',
            1000,
            100,
            () => now
        );
        expect(await jwks.get('a')).toEqual([{ kid: 'a' }]);
        now = 999;
        expect(await jwks.get('a')).toEqual([{ kid: 'a' }]);
        expect(requests).toEqual([url]);
        now = 1000;
        expect(await jwks.get()).toEqual([{ kid: 'b' }]);
        expect(requests).toEqual([url, url]);
    });

    test('an unknown kid fetches again, at most once per minRefetchMs', async () => {
        let now = 0;
        const { client, requests } = fakeClient([
            keys('a'),
            keys('a', 'b'),
            keys('c')
        ]);
        const jwks = new Jwks(
            client,
            '/.well-known/jwks.json',
            10_000,
            100,
            () => now
        );
        await jwks.get('a');
        now = 50;
        expect(await jwks.get('b')).toEqual([{ kid: 'a' }]);
        now = 100;
        expect(await jwks.get('b')).toEqual([{ kid: 'a' }, { kid: 'b' }]);
        expect(requests).toHaveLength(2);
    });

    test('concurrent lookups share one request; an answer without keys is no keys', async () => {
        const { client, requests } = fakeClient([{ nope: true }]);
        const jwks = new Jwks(client, '/.well-known/jwks.json');
        expect(await Promise.all([jwks.get(), jwks.get()])).toEqual([[], []]);
        expect(requests).toHaveLength(1);
    });

    test('a failed fetch fails the lookup, and the next one tries again', async () => {
        const { client, requests } = fakeClient([keys('a')]);
        const failing = {
            url: client.url,
            fetchJson: async () => {
                throw new Error('HTTP 502');
            }
        } as unknown as ShopClient;
        const jwks = new Jwks(failing, '/.well-known/jwks.json');
        await expect(jwks.get()).rejects.toThrow('HTTP 502');
        (failing as any).fetchJson = client.fetchJson;
        expect(await jwks.get()).toEqual([{ kid: 'a' }]);
        expect(requests).toHaveLength(1);
    });
});
