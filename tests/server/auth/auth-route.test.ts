import { beforeEach, describe, expect, test } from 'bun:test';
import type { AuthState } from '@/shared/account';
import {
    adminIds,
    authHandlers,
    LOGIN_COOKIE,
    readCookie,
    SESSION_COOKIE,
    SESSION_MS,
    SIGN_IN_BUCKETS
} from '@/server/auth/auth-route';
import type {
    TelegramIdentity,
    TelegramLogin
} from '@/server/auth/telegram-login';
import { codeChallenge, tokenHash } from '@/server/auth/tokens';
import { openDatabase } from '@/server/db/database';
import { ListStore } from '@/server/db/list-store';
import { UserStore } from '@/server/db/user-store';
import { RateLimiter } from '@/server/http/rate-limiter';
import { captureLogs } from '../capture-logs';

const logs = captureLogs();
const BASE = 'https://cards.example';
const john = {
    telegramId: 987654321,
    username: 'johndoe',
    displayName: 'John Doe'
};

// A stand-in for Telegram: hands out an authorize URL, and answers `identify` with `who` (or throws it).
function fakeTelegram(who: () => TelegramIdentity) {
    const calls: { code: string; verifier: string }[] = [];
    const telegram = {
        authorizeUrl: (state: string, challenge: string) =>
            `https://oauth.telegram.org/auth?state=${state}&code_challenge=${challenge}`,
        identify: async (code: string, verifier: string) => {
            calls.push({ code, verifier });
            return who();
        }
    } as unknown as TelegramLogin;
    return { telegram, calls };
}

const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieValue = (res: Response, name: string) =>
    setCookies(res)
        .find((c) => c.startsWith(`${name}=`))
        ?.split(';')[0]!
        .slice(name.length + 1);
const withCookies = (url: string, cookies: Record<string, string>) =>
    new Request(new URL(url, BASE), {
        headers: {
            cookie: Object.entries(cookies)
                .map(([k, v]) => `${k}=${v}`)
                .join('; ')
        }
    });
// Telegram's redirect back, from one client (`clientKey`'s address) unless said otherwise
const callback = (
    auth: ReturnType<typeof authHandlers>,
    req: Request,
    client = '1.2.3.4'
) => auth.callback(req, client);

describe('auth routes', () => {
    let users: UserStore;
    let now: number;
    beforeEach(() => {
        users = new UserStore(openDatabase(':memory:'));
        logs.length = 0; // the migration's log line
        now = 1_000_000;
    });
    const handlers = (
        who: () => TelegramIdentity = () => john,
        admins = new Set<number>()
    ) => {
        const fake = fakeTelegram(who);
        return {
            ...fake,
            auth: authHandlers(users, fake.telegram, admins, () => now)
        };
    };

    // A login, and the callback request Telegram's redirect back would make for it.
    const loginRequest = async (auth: ReturnType<typeof authHandlers>) => {
        const start = auth.login();
        const login = cookieValue(start, LOGIN_COOKIE)!;
        const state = new URL(start.headers.get('Location')!).searchParams.get(
            'state'
        )!;
        return {
            req: withCookies(
                `/api/auth/callback?code=the-code&state=${state}`,
                { [LOGIN_COOKIE]: login }
            )
        };
    };

    // Runs a whole sign-in: login, then Telegram's redirect back with `code` (and the state, unless `state` says
    // otherwise). Returns the callback's response.
    const signIn = async (
        auth: ReturnType<typeof authHandlers>,
        {
            code = 'the-code',
            state
        }: { code?: string; state?: string | null } = {}
    ) => {
        const start = auth.login();
        const login = cookieValue(start, LOGIN_COOKIE)!;
        const sent = new URL(start.headers.get('Location')!).searchParams.get(
            'state'
        )!;
        const back = state === null ? '' : `&state=${state ?? sent}`;
        return callback(
            auth,
            withCookies(`/api/auth/callback?code=${code}${back}`, {
                [LOGIN_COOKIE]: login
            })
        );
    };
    const me = async (
        auth: ReturnType<typeof authHandlers>,
        session?: string
    ) =>
        (await auth
            .me(
                withCookies(
                    '/api/auth/me',
                    session ? { [SESSION_COOKIE]: session } : {}
                )
            )
            .json()) as AuthState;

    test('login sends the browser to Telegram, keeping the state and PKCE verifier in a short-lived cookie', () => {
        const { auth } = handlers();
        const res = auth.login();
        expect(res.status).toBe(302);
        const sent = new URL(res.headers.get('Location')!).searchParams;
        const cookie = setCookies(res)[0]!;
        expect(cookie).toMatch(
            new RegExp(
                `^${LOGIN_COOKIE}=[\\w-]+\\.[\\w-]+; Path=/api/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax$`
            )
        );
        const [state, verifier] = cookieValue(res, LOGIN_COOKIE)!.split('.');
        expect(sent.get('state')).toBe(state!);
        expect(sent.get('code_challenge')).toBe(codeChallenge(verifier!));
    });

    test('a sign-in starts a 30-day session and lands on the lists page; me then knows the user', async () => {
        const { auth, calls } = handlers();
        const res = await signIn(auth);
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/lists');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const cookies = setCookies(res);
        expect(cookies[0]).toBe(
            `${LOGIN_COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
        );
        expect(cookies[1]).toMatch(
            new RegExp(
                `^${SESSION_COOKIE}=[\\w-]{43}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$`
            )
        );
        expect(calls).toEqual([
            { code: 'the-code', verifier: expect.any(String) }
        ]);

        const session = cookieValue(res, SESSION_COOKIE)!;
        expect(await me(auth, session)).toEqual({
            user: {
                username: 'johndoe',
                displayName: 'John Doe',
                admin: false
            },
            loginEnabled: true
        });
        // the database has the hash, never the token
        const user = users.sessionUser(tokenHash(session), now)!;
        expect(user.telegramId).toBe(987654321);
        expect(
            auth.currentUser(withCookies('/', { [SESSION_COOKIE]: session }))
                ?.id
        ).toBe(user.id);
        expect(users.sessionUser(session, now)).toBeNull();
        expect(logs.map((l) => [l.message, l.user])).toEqual([
            ['user signed in', user.id]
        ]);
        expect(JSON.stringify(logs)).not.toContain('johndoe');

        now += SESSION_MS;
        expect((await me(auth, session)).user).toBeNull();
    });

    test('state comes back optional, but must match when it does', async () => {
        expect(
            (await signIn(handlers().auth, { state: null })).headers.get(
                'Location'
            )
        ).toBe('/lists');
        const { auth, calls } = handlers();
        expect(
            (await signIn(auth, { state: 'forged' })).headers.get('Location')
        ).toBe('/lists?login=expired');
        expect(calls).toEqual([]);
    });

    test("a callback without this browser's sign-in cookie is turned away", async () => {
        const { auth, calls } = handlers();
        const cookies: Record<string, string>[] = [
            {},
            { [LOGIN_COOKIE]: 'no-dot' },
            { [LOGIN_COOKIE]: '.v' }
        ];
        for (const cookie of cookies) {
            const res = await callback(
                auth,
                withCookies('/api/auth/callback?code=c&state=s', cookie)
            );
            expect(res.headers.get('Location')).toBe('/lists?login=expired');
            expect(setCookies(res)).toEqual([
                `${LOGIN_COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
            ]);
        }
        expect(calls).toEqual([]);
    });

    test('no code (the user went back) is a cancelled sign-in', async () => {
        const { auth } = handlers();
        const res = await callback(
            auth,
            withCookies('/api/auth/callback?error=access_denied', {})
        );
        expect(res.headers.get('Location')).toBe('/lists?login=cancelled');
    });

    test('a failed exchange is logged and reported, with no session', async () => {
        const { auth } = handlers(() => {
            throw new Error('invalid signature');
        });
        const res = await signIn(auth);
        expect(res.headers.get('Location')).toBe('/lists?login=failed');
        expect(cookieValue(res, SESSION_COOKIE)).toBeUndefined();
        expect(
            logs.map((l) => [l.level, l.message, (l.error as Error).message])
        ).toEqual([['warn', 'telegram sign-in failed', 'invalid signature']]);
    });

    test('an account without a username is turned away, and not stored', async () => {
        const { auth } = handlers(() => ({ ...john, username: null }));
        const res = await signIn(auth);
        expect(res.headers.get('Location')).toBe('/lists?login=no-username');
        expect(cookieValue(res, SESSION_COOKIE)).toBeUndefined();
        expect(users.get(1)).toBeNull();
    });

    test('a banned user is turned away', async () => {
        const { auth } = handlers();
        users.setBanned(users.login(john).id, true);
        const res = await signIn(auth);
        expect(res.headers.get('Location')).toBe('/lists?login=banned');
        expect(cookieValue(res, SESSION_COOKIE)).toBeUndefined();
    });

    test('signing in clears expired sessions', async () => {
        const { auth } = handlers();
        const user = users.login(john, 0);
        users.startSession('old', user.id, now - 1);
        await signIn(auth);
        expect(users.purgeSessions(now)).toBe(0);
    });

    test('admins are the Telegram ids configured', async () => {
        const { auth } = handlers(() => john, new Set([987654321]));
        const session = cookieValue(await signIn(auth), SESSION_COOKIE)!;
        expect((await me(auth, session)).user?.admin).toBe(true);
        expect(auth.isAdmin(users.sessionUser(tokenHash(session), now)!)).toBe(
            true
        );
    });

    test('logout ends the session and clears the cookie', async () => {
        const { auth } = handlers();
        const session = cookieValue(await signIn(auth), SESSION_COOKIE)!;
        const res = auth.logout(
            withCookies('/api/auth/logout', { [SESSION_COOKIE]: session })
        );
        expect(res.status).toBe(204);
        expect(setCookies(res)).toEqual([
            `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
        ]);
        expect((await me(auth, session)).user).toBeNull();
        expect(auth.logout(withCookies('/api/auth/logout', {})).status).toBe(
            204
        );
    });

    test('deleting the account removes the user, their sessions and lists, and signs them out', async () => {
        const db = openDatabase(':memory:');
        users = new UserStore(db);
        const lists = new ListStore(db);
        const { auth } = handlers();
        const session = cookieValue(await signIn(auth), SESSION_COOKIE)!;
        const user = auth.currentUser(
            withCookies('/', { [SESSION_COOKIE]: session })
        )!;
        lists.submit(user.id, { source: 'manabox', ref: 'abc' });
        logs.length = 0;

        const res = auth.deleteAccount(
            withCookies('/api/auth/me', { [SESSION_COOKIE]: session })
        );
        expect(res.status).toBe(204);
        expect(setCookies(res)).toEqual([
            `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
        ]);
        expect(users.get(user.id)).toBeNull();
        expect(lists.ofUser(user.id)).toEqual([]);
        expect(db.query('SELECT * FROM sessions').all()).toEqual([]);
        expect(logs.map((l) => [l.message, l.user])).toEqual([
            ['account deleted', user.id]
        ]);

        expect(auth.deleteAccount(withCookies('/api/auth/me', {})).status).toBe(
            401
        );
    });

    test("past its limit, a client's sign-ins are turned away before reaching Telegram; others aren't", async () => {
        const fake = fakeTelegram(() => john);
        const auth = authHandlers(
            users,
            fake.telegram,
            new Set(),
            () => now,
            new RateLimiter([{ capacity: 2, refillMs: 60_000 }], () => now)
        );
        // forged callbacks: any `a.b` cookie and any code get as far as the token exchange
        const forged = (client = '6.6.6.6') =>
            callback(
                auth,
                withCookies('/api/auth/callback?code=junk', {
                    [LOGIN_COOKIE]: 'a.b'
                }),
                client
            );
        await forged();
        await forged();
        expect(fake.calls).toHaveLength(2);
        logs.length = 0;
        const refused = await forged();
        expect(refused.headers.get('Location')).toBe('/lists?login=busy');
        expect(setCookies(refused)).toEqual([
            `${LOGIN_COOKIE}=; Path=/api/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
        ]);
        expect(fake.calls).toHaveLength(2);
        // the address isn't logged
        expect(logs).toEqual([
            expect.objectContaining({
                message: 'sign-in refused',
                retryAfter: 30
            })
        ]);
        expect(JSON.stringify(logs)).not.toContain('6.6.6.6');
        // someone else signs in as usual
        expect(
            (
                await callback(auth, (await loginRequest(auth)).req, '5.5.5.5')
            ).headers.get('Location')
        ).toBe('/lists');
        // and the refused client can again once its bucket refills
        now += 30_000;
        await forged();
        expect(fake.calls).toHaveLength(4);
    });

    test("callbacks that fail the free checks don't use up the client's sign-ins", async () => {
        const fake = fakeTelegram(() => john);
        const auth = authHandlers(
            users,
            fake.telegram,
            new Set(),
            () => now,
            new RateLimiter([{ capacity: 1, refillMs: 60_000 }], () => now)
        );
        for (let i = 0; i < 5; i++)
            await callback(auth, withCookies('/api/auth/callback?code=c', {}));
        expect(fake.calls).toEqual([]);
        const { req } = await loginRequest(auth);
        expect((await callback(auth, req)).headers.get('Location')).toBe(
            '/lists'
        );
    });

    test('by default the limit is SIGN_IN_BUCKETS, per client', async () => {
        const { auth, calls } = handlers();
        const { capacity } = SIGN_IN_BUCKETS[0]!;
        for (let i = 0; i <= capacity; i++)
            await callback(auth, (await loginRequest(auth)).req);
        expect(calls).toHaveLength(capacity);
    });

    test('without a bot, sign-in is off: login is 503, me says so, a callback goes nowhere', async () => {
        const auth = authHandlers(users, null, new Set());
        expect(auth.login().status).toBe(503);
        expect(await me(auth)).toEqual({ user: null, loginEnabled: false });
        expect((await me(auth, 'unknown-token')).user).toBeNull();
        const res = await callback(
            auth,
            withCookies('/api/auth/callback?code=c', {})
        );
        expect(res.headers.get('Location')).toBe('/lists?login=cancelled');
    });
});

describe('readCookie', () => {
    test('finds one cookie among several', () => {
        const req = new Request(BASE, {
            headers: { cookie: 'a=1; session=abc=; b' }
        });
        expect(readCookie(req, 'session')).toBe('abc=');
        expect(readCookie(req, 'a')).toBe('1');
        expect(readCookie(req, 'b')).toBeNull();
        expect(readCookie(new Request(BASE), 'a')).toBeNull();
    });
});

describe('adminIds', () => {
    test('comma-separated Telegram ids; anything else is ignored', () => {
        expect(
            adminIds({ ADMIN_TELEGRAM_IDS: ' 123, 456 ,x,,-1,1.5' })
        ).toEqual(new Set([123, 456]));
        expect(adminIds({})).toEqual(new Set());
    });
});
