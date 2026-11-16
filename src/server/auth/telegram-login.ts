import { ShopClient } from '../shop-client';
import { IdTokenError, Jwks, verifyIdToken } from './id-token';

// "Log in with Telegram" over OpenID Connect: the authorization code flow with PKCE, done by the server
// (https://core.telegram.org/bots/telegram-login). The bot is set up in @BotFather → Login Widget, which gives the
// client ID and secret and takes the allowed redirect URL (<public URL>/api/auth/callback).

export const TELEGRAM_OAUTH = 'https://oauth.telegram.org';

export type TelegramLoginConfig = {
    clientId: string; // the bot's id, also the ID token's audience
    clientSecret: string;
    redirectUri: string;
};

// Who signed in. `username` is null for a Telegram account without one; such users can't be contacted
// through a link, so they're turned away.
export type TelegramIdentity = {
    telegramId: number;
    username: string | null;
    displayName: string;
};

// From the environment: TELEGRAM_CLIENT_ID and TELEGRAM_CLIENT_SECRET, and the site's public URL for the redirect:
// PUBLIC_URL, else Railway's own domain, else the local dev server. null (sign-in off) without the bot's details.
export function telegramLoginConfig(
    env: Record<string, string | undefined> = process.env
): TelegramLoginConfig | null {
    const {
        TELEGRAM_CLIENT_ID: clientId,
        TELEGRAM_CLIENT_SECRET: clientSecret
    } = env;
    if (!clientId || !clientSecret) return null;
    const origin =
        env.PUBLIC_URL ??
        (env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
            : `http://localhost:${env.PORT ?? 3000}`);
    return {
        clientId,
        clientSecret,
        redirectUri: new URL('/api/auth/callback', origin).href
    };
}

type TokenResponse = { id_token?: unknown };

export class TelegramLogin {
    constructor(
        private readonly config: TelegramLoginConfig,
        private readonly client = new ShopClient(TELEGRAM_OAUTH),
        private readonly jwks = new Jwks(client, '/.well-known/jwks.json')
    ) {}

    // Where to send the user's browser. Only the profile is asked for: the name and username shown to buyers.
    authorizeUrl(state: string, codeChallenge: string): string {
        return this.client.url('/auth', {
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            response_type: 'code',
            scope: 'openid profile',
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        });
    }

    // Trades the code Telegram sent back for the ID token, and reads the user from it once it checks out.
    async identify(
        code: string,
        codeVerifier: string,
        now = Date.now()
    ): Promise<TelegramIdentity> {
        const { clientId, clientSecret, redirectUri } = this.config;
        const answer = await this.client.fetchJson<TokenResponse>(
            this.client.url('/token'),
            {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: redirectUri,
                    client_id: clientId,
                    code_verifier: codeVerifier
                })
            }
        );
        if (typeof answer?.id_token !== 'string')
            throw new IdTokenError('no ID token in the answer');
        const claims = await verifyIdToken(
            answer.id_token,
            (kid) => this.jwks.get(kid),
            { issuer: TELEGRAM_OAUTH, audience: clientId },
            now
        );
        return identity(claims);
    }
}

// Telegram's user id is the `id` claim (`sub` is another identifier), a number or a string of digits.
function identity(claims: Record<string, unknown>): TelegramIdentity {
    const { id } = claims;
    const telegramId =
        typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;
    if (typeof telegramId !== 'number' || !Number.isSafeInteger(telegramId))
        // the claims' names (never their values) show where the id went
        throw new IdTokenError(
            `no user id in the token (id: ${typeof id}; claims: ${Object.keys(claims).sort().join(', ')})`
        );
    const text = (v: unknown) =>
        typeof v === 'string' && v.trim() ? v.trim() : null;
    const username = text(claims.preferred_username)?.replace(/^@/, '') || null;
    const fullName = [claims.given_name, claims.family_name]
        .map(text)
        .filter(Boolean)
        .join(' ');
    return {
        telegramId,
        username,
        displayName:
            text(claims.name) ?? (fullName || username || String(telegramId))
    };
}
