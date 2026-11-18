import { beforeAll, describe, expect, test } from 'bun:test';
import { IdTokenError, Jwks } from '@/server/auth/id-token';
import {
    TELEGRAM_OAUTH,
    TelegramLogin,
    telegramLoginConfig,
    type TelegramLoginConfig
} from '@/server/auth/telegram-login';
import { ShopClient } from '@/server/shop-client';
import { signingKey } from './signing-keys';

const config: TelegramLoginConfig = {
    clientId: '123456',
    clientSecret: 'secret',
    redirectUri: 'https://cards.example/api/auth/callback'
};
const NOW = 1_700_000_000_000;
const claims = {
    iss: TELEGRAM_OAUTH,
    aud: '123456',
    sub: '1234123412341234123',
    iat: NOW / 1000,
    exp: NOW / 1000 + 3600,
    id: 987654321,
    name: 'John Doe',
    given_name: 'John',
    family_name: 'Doe',
    preferred_username: 'johndoe',
    picture: 'https://cdn4.telesco.pe/file'
};

describe('telegramLoginConfig', () => {
    const bot = {
        TELEGRAM_CLIENT_ID: '123456',
        TELEGRAM_CLIENT_SECRET: 'secret'
    };

    test("off without the bot's id and secret", () => {
        expect(telegramLoginConfig({})).toBeNull();
        expect(telegramLoginConfig({ TELEGRAM_CLIENT_ID: '1' })).toBeNull();
    });

    test("the redirect is on PUBLIC_URL, else Railway's domain, else the dev server", () => {
        const redirect = (env: Record<string, string>) =>
            telegramLoginConfig({ ...bot, ...env })?.redirectUri;
        expect(
            redirect({
                PUBLIC_URL: 'https://cards.example/',
                RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app'
            })
        ).toBe('https://cards.example/api/auth/callback');
        expect(redirect({ RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' })).toBe(
            'https://x.up.railway.app/api/auth/callback'
        );
        expect(redirect({ PORT: '4000' })).toBe(
            'http://localhost:4000/api/auth/callback'
        );
        expect(telegramLoginConfig(bot)).toEqual({
            clientId: '123456',
            clientSecret: 'secret',
            redirectUri: 'http://localhost:3000/api/auth/callback'
        });
    });
});

describe('TelegramLogin', () => {
    let key: Awaited<ReturnType<typeof signingKey>>;
    beforeAll(async () => {
        key = await signingKey('RS256', 'oidc-1');
    });

    // A client that answers the token request with `answer` and the JWKS with the test key.
    function login(answer: () => Promise<unknown> | unknown) {
        const real = new ShopClient(TELEGRAM_OAUTH);
        const requests: { url: string; init?: RequestInit }[] = [];
        const client = {
            url: real.url.bind(real),
            fetchJson: async (url: string, init?: RequestInit) => {
                requests.push({ url, init });
                if (url.endsWith('/.well-known/jwks.json'))
                    return { keys: [key.jwk] };
                return answer();
            }
        } as unknown as ShopClient;
        return {
            telegram: new TelegramLogin(
                config,
                client,
                new Jwks(client, '/.well-known/jwks.json')
            ),
            requests
        };
    }

    test('authorizeUrl: the code flow with PKCE, asking for the profile', () => {
        const url = new URL(
            login(() => null).telegram.authorizeUrl('st', 'ch')
        );
        expect(url.origin + url.pathname).toBe(
            'https://oauth.telegram.org/auth'
        );
        expect(Object.fromEntries(url.searchParams)).toEqual({
            client_id: '123456',
            redirect_uri: 'https://cards.example/api/auth/callback',
            response_type: 'code',
            scope: 'openid profile',
            state: 'st',
            code_challenge: 'ch',
            code_challenge_method: 'S256'
        });
    });

    test('identify: trades the code (with the verifier) for a verified ID token, and reads the user', async () => {
        const { telegram, requests } = login(async () => ({
            access_token: 'x',
            id_token: await key.sign(claims)
        }));
        expect(
            await telegram.identify('the-code', 'the-verifier', NOW)
        ).toEqual({
            telegramId: 987654321,
            username: 'johndoe',
            displayName: 'John Doe'
        });
        const token = requests[0]!;
        expect(token.url).toBe('https://oauth.telegram.org/token');
        expect(token.init?.method).toBe('POST');
        expect(token.init?.headers).toEqual({
            Authorization: `Basic ${btoa('123456:secret')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        expect(Object.fromEntries(token.init?.body as URLSearchParams)).toEqual(
            {
                grant_type: 'authorization_code',
                code: 'the-code',
                redirect_uri: 'https://cards.example/api/auth/callback',
                client_id: '123456',
                code_verifier: 'the-verifier'
            }
        );
    });

    const identifyWith = async (overrides: object) => {
        const { telegram } = login(async () => ({
            id_token: await key.sign({ ...claims, ...overrides })
        }));
        return telegram.identify('c', 'v', NOW);
    };

    test('the name falls back to the first and last name, then the username, then the id', async () => {
        expect((await identifyWith({ name: ' ' })).displayName).toBe(
            'John Doe'
        );
        expect(
            (await identifyWith({ name: undefined, family_name: undefined }))
                .displayName
        ).toBe('John');
        expect(
            (
                await identifyWith({
                    name: undefined,
                    given_name: undefined,
                    family_name: undefined
                })
            ).displayName
        ).toBe('johndoe');
        expect(
            await identifyWith({
                name: undefined,
                given_name: undefined,
                family_name: undefined,
                preferred_username: undefined
            })
        ).toEqual({
            telegramId: 987654321,
            username: null,
            displayName: '987654321'
        });
    });

    test('a username loses its @; an empty one is none', async () => {
        expect(
            (await identifyWith({ preferred_username: '@johndoe' })).username
        ).toBe('johndoe');
        expect(
            (await identifyWith({ preferred_username: '@' })).username
        ).toBeNull();
        expect(
            (await identifyWith({ preferred_username: 42 })).username
        ).toBeNull();
    });

    test('the user id may come as a string of digits', async () => {
        expect((await identifyWith({ id: '987654321' })).telegramId).toBe(
            987654321
        );
    });

    test('a token without a numeric user id is refused, naming the claims it has but not their values', async () => {
        for (const [id, type] of [
            [undefined, 'undefined'],
            ['98765x', 'string'],
            [1.5, 'number']
        ] as const) {
            const error = await identifyWith({ id }).catch((e) => e);
            expect(error).toBeInstanceOf(IdTokenError);
            expect(error.message).toStartWith(
                `no user id in the token (id: ${type}; claims: aud, exp, family_name, given_name, iat,`
            );
            expect(error.message).not.toContain('johndoe');
        }
    });

    test('an answer without an ID token, or a failed request, fails the sign-in', async () => {
        await expect(
            login(() => ({ access_token: 'x' })).telegram.identify('c', 'v')
        ).rejects.toThrow('no ID token in the answer');
        await expect(
            login(() => null).telegram.identify('c', 'v')
        ).rejects.toThrow('no ID token in the answer');
        await expect(
            login(() => {
                throw new Error('HTTP 400');
            }).telegram.identify('c', 'v')
        ).rejects.toThrow('HTTP 400');
    });
});
