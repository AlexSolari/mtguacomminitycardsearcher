import { describe, expect, test } from 'bun:test';
import { InFlightLimiter } from '@/server/in-flight-limiter';

const clientCount = (l: InFlightLimiter) =>
    (l as unknown as { clients: Map<string, unknown> }).clients.size;

describe('InFlightLimiter', () => {
    test('runs up to `max` at once; the rest wait, first come first served', async () => {
        const limiter = new InFlightLimiter(3);
        let active = 0;
        let peak = 0;
        const started: number[] = [];
        await Promise.all(
            Array.from({ length: 7 }, (_, i) =>
                limiter.run('a', async () => {
                    started.push(i);
                    peak = Math.max(peak, ++active);
                    await Bun.sleep(20);
                    active--;
                })
            )
        );
        expect(peak).toBe(3);
        expect(started).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    test('clients have separate limits', async () => {
        const limiter = new InFlightLimiter(1);
        let active = 0;
        let peak = 0;
        const card = async () => {
            peak = Math.max(peak, ++active);
            await Bun.sleep(20);
            active--;
        };
        await Promise.all([limiter.run('a', card), limiter.run('b', card)]);
        expect(peak).toBe(2);
    });

    test('a waiting card whose request is cancelled never runs', async () => {
        const limiter = new InFlightLimiter(1);
        const controller = new AbortController();
        const ran: string[] = [];
        const first = limiter.run('a', async () => {
            ran.push('first');
            await Bun.sleep(30);
        });
        const cancelled = limiter.run(
            'a',
            async () => void ran.push('cancelled'),
            controller.signal
        );
        const last = limiter.run('a', async () => void ran.push('last'));
        controller.abort();
        await expect(cancelled).rejects.toHaveProperty('name', 'AbortError');
        await Promise.all([first, last]);
        expect(ran).toEqual(['first', 'last']);
    });

    test('a failing card frees its slot', async () => {
        const limiter = new InFlightLimiter(1);
        const failing = limiter.run('a', async () => {
            throw new Error('boom');
        });
        await expect(failing).rejects.toThrow('boom');
        expect(await limiter.run('a', async () => 'next')).toBe('next');
    });

    test('forgets a client once it has nothing running or waiting', async () => {
        const limiter = new InFlightLimiter(2);
        await Promise.all(
            [1, 2, 3].map(() => limiter.run('a', async () => {}))
        );
        await Bun.sleep(0); // the idle event
        expect(clientCount(limiter)).toBe(0);
    });
});
