// Random tokens and their hashes, for sessions and the sign-in's PKCE.

// 32 random bytes, base64url: a session token, a PKCE verifier, an OAuth state.
export const randomToken = (bytes = 32) =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
        'base64url'
    );

// What a session is stored by, so the database never holds a token a stolen copy could sign in with.
export const tokenHash = (token: string) =>
    new Bun.CryptoHasher('sha256').update(token).digest('hex');

// PKCE's S256 challenge: base64url(sha256(verifier)).
export const codeChallenge = (verifier: string) =>
    Buffer.from(
        new Bun.CryptoHasher('sha256').update(verifier).digest()
    ).toString('base64url');
