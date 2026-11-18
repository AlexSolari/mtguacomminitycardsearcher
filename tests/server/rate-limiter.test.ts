import { describe, expect, test } from 'bun:test';
import { RateLimiter, tooManyRequests } from '@/server/rate-limiter';

// A limiter on a clock the test moves by hand.
function limiter(buckets: { capacity: number; refillMs: number }[]) {
    const clock = { now: 0 };
    return { clock, rate: new RateLimiter(buckets, () => clock.now) };
}

const clientCount = (l: RateLimiter) =>
    (l as unknown as { clients: Map<string, unknown> }).clients.size;

describe('RateLimiter', () => {
    test('allows a burst up to the capacity, then refuses until tokens refill', () => {
        const { clock, rate } = limiter([{ capacity: 10, refillMs: 10_000 }]);
        expect(rate.take('a', 6)).toEqual({ ok: true });
        expect(rate.take('a', 4)).toEqual({ ok: true });
        // empty: a token comes back every second
        expect(rate.take('a', 3)).toEqual({ ok: false, retryAfterMs: 3000 });
        clock.now = 3000;
        expect(rate.take('a', 3)).toEqual({ ok: true });
    });

    test('a refused take spends nothing', () => {
        const { rate } = limiter([{ capacity: 10, refillMs: 10_000 }]);
        expect(rate.take('a', 8).ok).toBe(true);
        expect(rate.take('a', 5).ok).toBe(false);
        expect(rate.take('a', 2).ok).toBe(true);
    });

    test('refills up to the capacity, no further', () => {
        const { clock, rate } = limiter([{ capacity: 10, refillMs: 10_000 }]);
        rate.take('a', 10);
        clock.now = 1_000_000;
        expect(rate.take('a', 10).ok).toBe(true);
        expect(rate.take('a', 1).ok).toBe(false);
    });

    test('every bucket must have the tokens; the wait is the longest', () => {
        const { clock, rate } = limiter([
            { capacity: 10, refillMs: 10_000 }, // 1 a second
            { capacity: 15, refillMs: 150_000 } // 1 every 10 s
        ]);
        expect(rate.take('a', 10).ok).toBe(true);
        clock.now = 10_000; // the first is full again, the second has 6
        expect(rate.take('a', 8)).toEqual({ ok: false, retryAfterMs: 20_000 });
        expect(rate.take('a', 6)).toEqual({ ok: true });
    });

    test('clients have separate buckets', () => {
        const { rate } = limiter([{ capacity: 1, refillMs: 1000 }]);
        expect(rate.take('a').ok).toBe(true);
        expect(rate.take('a').ok).toBe(false);
        expect(rate.take('b').ok).toBe(true);
    });

    test('forgets clients whose buckets have refilled', () => {
        const { clock, rate } = limiter([{ capacity: 5, refillMs: 1000 }]);
        rate.take('old', 5);
        clock.now = 2000;
        // the sweep runs every 1000 takes; 'new' is still spending
        for (let i = 0; i < 999; i++) rate.take('new', 0.001);
        expect(clientCount(rate)).toBe(1);
    });
});

describe('tooManyRequests', () => {
    test('a 429 with Retry-After in whole seconds, rounded up', async () => {
        const res = tooManyRequests(1200, { error: 'slow down' });
        expect(res.status).toBe(429);
        expect(res.headers.get('Retry-After')).toBe('2');
        expect(await res.json()).toEqual({ error: 'slow down' });
    });

    test('without a body, an empty one', async () => {
        const res = tooManyRequests(500);
        expect(res.status).toBe(429);
        expect(res.headers.get('Retry-After')).toBe('1');
        expect(await res.text()).toBe('');
    });
});
