import type { AuthState, LoginFailure } from '../../account';
import type { User, UserStore } from '../db/user-store';
import { logger } from '../logger';
import { RateLimiter, type Bucket } from '../rate-limiter';
import type { TelegramLogin } from './telegram-login';
import { codeChallenge, randomToken, tokenHash } from './tokens';

// Sign-in with Telegram and the session it starts:
//   GET  /api/auth/login     → Telegram's sign-in page
//   GET  /api/auth/callback  ← Telegram sends the user back here; starts the session, then on to LISTS_PAGE
//   GET    /api/auth/me      → { user, loginEnabled }
//   DELETE /api/auth/me      deletes the account, with its lists
//   POST   /api/auth/logout
// The session is a random token in an HttpOnly cookie; the database keeps only its hash. Only signed-in users
// get a cookie: it's strictly necessary, so it needs no consent banner (anonymous visitors still get none).

export const SESSION_COOKIE = 'session';
export const SESSION_MS = 30 * 24 * 60 * 60_000;
// The sign-in in progress: its state and PKCE verifier, for the callback. Scoped to /api/auth and short-lived.
export const LOGIN_COOKIE = 'tg_login';
const LOGIN_MS = 10 * 60_000;

// Where the user lands after signing in (the "Мої списки" page), with `?login=<reason>` when it failed.
export const LISTS_PAGE = '/lists';

// Sign-ins one client may complete over time (see RateLimiter). Each callback costs a token exchange with Telegram,
// through one shared client and its queue, and a request that gets that far is easy to forge (any cookie of the
// form `a.b` and any code). Without a limit, a flood would fill the queue and real sign-ins would fail. A person
// signs in a few times a day.
export const SIGN_IN_BUCKETS: Bucket[] = [
    { capacity: 5, refillMs: 60_000 },
    { capacity: 20, refillMs: 3_600_000 }
];

export function readCookie(req: Request, name: string): string | null {
    for (const part of req.headers.get('cookie')?.split(';') ?? []) {
        const at = part.indexOf('=');
        if (at > 0 && part.slice(0, at).trim() === name)
            return part.slice(at + 1).trim();
    }
    return null;
}

const cookie = (name: string, value: string, path: string, maxAgeMs: number) =>
    `${name}=${value}; Path=${path}; Max-Age=${Math.floor(maxAgeMs / 1000)}; HttpOnly; Secure; SameSite=Lax`;

const redirect = (location: string, ...cookies: string[]) => {
    const headers = new Headers({
        Location: location,
        'Cache-Control': 'no-store'
    });
    for (const c of cookies) headers.append('Set-Cookie', c);
    return new Response(null, { status: 302, headers });
};

// Telegram ids allowed to moderate: ADMIN_TELEGRAM_IDS, comma-separated.
export function adminIds(
    env: Record<string, string | undefined> = process.env
) {
    return new Set(
        (env.ADMIN_TELEGRAM_IDS ?? '')
            .split(',')
            .map((id) => Number(id.trim()))
            .filter((id) => Number.isSafeInteger(id) && id > 0)
    );
}

// `telegram` is null when sign-in isn't configured (no bot): the routes still answer, as "signed out".
export function authHandlers(
    users: UserStore,
    telegram: TelegramLogin | null,
    admins: Set<number>,
    now = () => Date.now(),
    signIns = new RateLimiter(SIGN_IN_BUCKETS, now)
) {
    const currentUser = (req: Request): User | null => {
        const token = readCookie(req, SESSION_COOKIE);
        return token ? users.sessionUser(tokenHash(token), now()) : null;
    };
    const failed = (reason: LoginFailure, ...cookies: string[]) =>
        redirect(`${LISTS_PAGE}?login=${reason}`, ...cookies);
    const clearLogin = cookie(LOGIN_COOKIE, '', '/api/auth', 0);

    return {
        currentUser,

        isAdmin: (user: User) => admins.has(user.telegramId),

        login(): Response {
            if (!telegram)
                return Response.json(
                    { error: 'Sign-in is not configured' },
                    { status: 503 }
                );
            const state = randomToken(16);
            const verifier = randomToken();
            return redirect(
                telegram.authorizeUrl(state, codeChallenge(verifier)),
                cookie(
                    LOGIN_COOKIE,
                    `${state}.${verifier}`,
                    '/api/auth',
                    LOGIN_MS
                )
            );
        },

        // The code is exchanged with the verifier from this browser's login cookie, so a code from a sign-in this
        // browser didn't start (a forged link) can't be used. Telegram's docs don't promise `state` comes back,
        // so it's checked only when it does. `client` is the caller (clientKey), for SIGN_IN_BUCKETS.
        async callback(req: Request, client: string): Promise<Response> {
            const params = new URL(req.url).searchParams;
            const [state, verifier] = (
                readCookie(req, LOGIN_COOKIE) ?? ''
            ).split('.');
            const code = params.get('code');
            if (!telegram || !code) return failed('cancelled', clearLogin);
            const returned = params.get('state');
            if (
                !state ||
                !verifier ||
                (returned !== null && returned !== state)
            )
                return failed('expired', clearLogin);
            // just before the request to Telegram: the checks above cost nothing
            const taken = signIns.take(client);
            if (!taken.ok) {
                // the client is the IP, so it's not logged (see AGENTS.md)
                logger.warn('sign-in refused', {
                    retryAfter: Math.ceil(taken.retryAfterMs / 1000)
                });
                return failed('busy', clearLogin);
            }

            let identity;
            try {
                identity = await telegram.identify(code, verifier, now());
            } catch (error) {
                logger.warn('telegram sign-in failed', { error });
                return failed('failed', clearLogin);
            }
            if (!identity.username) return failed('no-username', clearLogin);

            const user = users.login(
                { ...identity, username: identity.username },
                now()
            );
            if (user.banned) {
                logger.info('banned user turned away', { user: user.id });
                return failed('banned', clearLogin);
            }
            const token = randomToken();
            users.purgeSessions(now());
            users.startSession(tokenHash(token), user.id, now() + SESSION_MS);
            logger.info('user signed in', { user: user.id });
            return redirect(
                LISTS_PAGE,
                clearLogin,
                cookie(SESSION_COOKIE, token, '/', SESSION_MS)
            );
        },

        me(req: Request): Response {
            const user = currentUser(req);
            const state: AuthState = {
                user: user && {
                    username: user.username,
                    displayName: user.displayName,
                    admin: admins.has(user.telegramId)
                },
                loginEnabled: telegram !== null
            };
            return Response.json(state, {
                headers: { 'Cache-Control': 'no-store' }
            });
        },

        logout(req: Request): Response {
            const token = readCookie(req, SESSION_COOKIE);
            if (token) users.endSession(tokenHash(token));
            return new Response(null, {
                status: 204,
                headers: { 'Set-Cookie': cookie(SESSION_COOKIE, '', '/', 0) }
            });
        },

        // Everything stored about the user goes: their sessions, lists and the lists' cards go with them (the
        // tables' ON DELETE CASCADE). Signing in again starts a new account.
        deleteAccount(req: Request): Response {
            const user = currentUser(req);
            if (!user)
                return Response.json(
                    { error: 'Not signed in' },
                    { status: 401 }
                );
            users.remove(user.id);
            logger.info('account deleted', { user: user.id });
            return new Response(null, {
                status: 204,
                headers: { 'Set-Cookie': cookie(SESSION_COOKIE, '', '/', 0) }
            });
        }
    };
}
