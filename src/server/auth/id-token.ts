import type { ShopClient } from '../shop-client';

// Verifies OpenID Connect ID tokens (JWTs) with WebCrypto: the signature against the issuer's published keys
// (JWKS), then the issuer, audience and expiry.

export type Jwk = JsonWebKey & { kid?: string };
export type IdTokenClaims = Record<string, unknown>;

export class IdTokenError extends Error {}

// The algorithms Telegram signs with by default (RS256) or can be set to in @BotFather that WebCrypto verifies.
// EdDSA and ES256K are left out; a bot set to those fails sign-in with "unsupported algorithm".
const ALGORITHMS: Record<
    string,
    {
        key: RsaHashedImportParams | EcKeyImportParams;
        verify: AlgorithmIdentifier | EcdsaParams;
    }
> = {
    RS256: {
        key: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        verify: { name: 'RSASSA-PKCS1-v1_5' }
    },
    // a JWS ES256 signature is r‖s, the form WebCrypto expects
    ES256: {
        key: { name: 'ECDSA', namedCurve: 'P-256' },
        verify: { name: 'ECDSA', hash: 'SHA-256' }
    }
};

// Clocks differ a little; a token is still accepted this long after its expiry.
const LEEWAY_MS = 60_000;

const decode = (part: string): any => {
    try {
        return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    } catch {
        throw new IdTokenError('malformed token');
    }
};

export async function verifyIdToken(
    token: string,
    keys: (kid?: string) => Promise<Jwk[]>,
    expected: { issuer: string; audience: string },
    now = Date.now()
): Promise<IdTokenClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new IdTokenError('malformed token');
    const [header, payload, signature] = parts as [string, string, string];
    const { alg, kid } = decode(header) ?? {};
    const claims = decode(payload);
    if (!claims || typeof claims !== 'object')
        throw new IdTokenError('malformed token');

    const algorithm = ALGORITHMS[alg];
    if (!algorithm) throw new IdTokenError(`unsupported algorithm: ${alg}`);
    const candidates = (await keys(kid)).filter(
        (k) => (kid === undefined || k.kid === kid) && (!k.alg || k.alg === alg)
    );
    if (candidates.length === 0) throw new IdTokenError('no matching key');
    const data = new TextEncoder().encode(`${header}.${payload}`);
    const sig = Buffer.from(signature, 'base64url');
    let valid = false;
    for (const jwk of candidates) {
        try {
            const key = await crypto.subtle.importKey(
                'jwk',
                jwk,
                algorithm.key,
                false,
                ['verify']
            );
            valid = await crypto.subtle.verify(
                algorithm.verify,
                key,
                sig,
                data
            );
        } catch {
            valid = false; // a key of another type than the algorithm's
        }
        if (valid) break;
    }
    if (!valid) throw new IdTokenError('invalid signature');

    if (claims.iss !== expected.issuer) throw new IdTokenError('wrong issuer');
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.map(String).includes(expected.audience))
        throw new IdTokenError('wrong audience');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 + LEEWAY_MS <= now)
        throw new IdTokenError('token expired');
    return claims;
}

// The issuer's signing keys, fetched when first needed and again after `maxAgeMs`, or sooner when a token names a
// key we don't have (the issuer rotated its keys), at most once per `minRefetchMs`.
export class Jwks {
    private keys: Jwk[] = [];
    private fetchedAt = -Infinity;
    private pending: Promise<Jwk[]> | null = null;

    constructor(
        private readonly client: ShopClient,
        private readonly path: string,
        private readonly maxAgeMs = 60 * 60_000,
        private readonly minRefetchMs = 60_000,
        private readonly now = () => Date.now()
    ) {}

    async get(kid?: string): Promise<Jwk[]> {
        const age = this.now() - this.fetchedAt;
        const unknown =
            kid !== undefined && !this.keys.some((k) => k.kid === kid);
        if (age < this.maxAgeMs && !(unknown && age >= this.minRefetchMs))
            return this.keys;
        // concurrent sign-ins share one request
        this.pending ??= this.client
            .fetchJson<{ keys?: unknown }>(this.client.url(this.path))
            .then((body) => {
                this.keys = Array.isArray(body?.keys) ? body.keys : [];
                this.fetchedAt = this.now();
                return this.keys;
            })
            .finally(() => (this.pending = null));
        return this.pending;
    }
}
