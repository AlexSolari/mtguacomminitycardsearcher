// Caps how much each client may spend over time, unlike InFlightLimiter, which caps how much it has going at once.
// Without it a script could keep its in-flight slots full forever, spending the budgets every user shares (MTGin's
// and Mana Vault's 60 a minute, Scryfall's 2 a second) and the tracing quota.
// Each bucket holds up to `capacity` tokens and refills completely over `refillMs`, at an even rate. A cost is taken
// only when every bucket can pay it, so a short burst (a whole list at once) passes while a sustained rate is held to
// the slowest bucket's refill.
export type Bucket = { capacity: number; refillMs: number };

export type Taken = { ok: true } | { ok: false; retryAfterMs: number };

// How many takes pass between sweeps of the clients whose buckets have refilled.
const SWEEP_EVERY = 1000;

export class RateLimiter {
    // per client, the tokens in each bucket and when they were counted
    private readonly clients = new Map<
        string,
        { tokens: number[]; at: number }
    >();
    private takes = 0;

    constructor(
        private readonly buckets: Bucket[],
        private readonly now: () => number = Date.now
    ) {}

    // Takes `cost` tokens from each of `client`'s buckets, or nothing, saying how long until it could.
    take(client: string, cost = 1): Taken {
        const now = this.now();
        if (++this.takes % SWEEP_EVERY === 0) this.sweep(now);
        const tokens = this.tokensAt(client, now);
        const waits = this.buckets.map((bucket, i) =>
            tokens[i]! >= cost
                ? 0
                : Math.ceil(
                      ((cost - tokens[i]!) * bucket.refillMs) / bucket.capacity
                  )
        );
        const retryAfterMs = Math.max(...waits);
        if (retryAfterMs > 0) return { ok: false, retryAfterMs };
        this.clients.set(client, {
            tokens: tokens.map((t) => t - cost),
            at: now
        });
        return { ok: true };
    }

    private tokensAt(client: string, now: number): number[] {
        const saved = this.clients.get(client);
        return this.buckets.map((bucket, i) =>
            saved
                ? Math.min(
                      bucket.capacity,
                      saved.tokens[i]! +
                          ((now - saved.at) * bucket.capacity) / bucket.refillMs
                  )
                : bucket.capacity
        );
    }

    // A client whose buckets are all full again is the same as one never seen, so it's dropped: the map doesn't keep
    // every address that ever searched.
    private sweep(now: number) {
        for (const client of this.clients.keys())
            if (
                this.tokensAt(client, now).every(
                    (t, i) => t >= this.buckets[i]!.capacity
                )
            )
                this.clients.delete(client);
    }
}

// The response to a client over its limit. `Retry-After` is in whole seconds, rounded up.
export function tooManyRequests(retryAfterMs: number, body?: object): Response {
    const headers = { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) };
    return body
        ? Response.json(body, { status: 429, headers })
        : new Response(null, { status: 429, headers });
}
