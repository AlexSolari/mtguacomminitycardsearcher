// Test keys that sign ID tokens the way Telegram's do, with the public half as a JWKS entry.
import type { Jwk } from '@/server/auth/id-token';

const b64 = (s: string) => Buffer.from(s).toString('base64url');

export async function signingKey(alg: 'RS256' | 'ES256', kid: string = alg) {
    const { privateKey, publicKey } = (await crypto.subtle.generateKey(
        alg === 'RS256'
            ? {
                  name: 'RSASSA-PKCS1-v1_5',
                  modulusLength: 2048,
                  publicExponent: new Uint8Array([1, 0, 1]),
                  hash: 'SHA-256'
              }
            : { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
    )) as CryptoKeyPair;
    const jwk: Jwk = {
        ...(await crypto.subtle.exportKey('jwk', publicKey)),
        kid,
        alg
    };
    // `header` overrides the token's header fields (alg, kid)
    const sign = async (claims: unknown, header: object = {}) => {
        const head = b64(JSON.stringify({ alg, kid, typ: 'JWT', ...header }));
        const body = b64(JSON.stringify(claims));
        const signature = await crypto.subtle.sign(
            alg === 'RS256'
                ? { name: 'RSASSA-PKCS1-v1_5' }
                : { name: 'ECDSA', hash: 'SHA-256' },
            privateKey,
            new TextEncoder().encode(`${head}.${body}`)
        );
        return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;
    };
    return { jwk, sign };
}
