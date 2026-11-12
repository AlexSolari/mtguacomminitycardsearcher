import { describe, expect, test } from 'bun:test';
import { WindowBudget } from '@/server/window-budget';

const WINDOW = 40;
const ok = async () => 'ok';

describe('WindowBudget', () => {
    test('requests within the budget go out at once', async () => {
        const budget = new WindowBudget(5, 10_000);
        const started = performance.now();
        for (const cost of [1, 2, 2])
            expect(await budget.run(cost, ok)).toBe('ok');
        expect(performance.now() - started).toBeLessThan(20);
    });

    // the API opens its window on receiving the first request, before that request settles here
    test('past the budget, a request waits until the window ends, timed from when its first request settled', async () => {
        const budget = new WindowBudget(2, WINDOW);
        await budget.run(1, () => Bun.sleep(20));
        const settled = performance.now();
        await budget.run(1, ok);
        await budget.run(1, ok);
        expect(performance.now() - settled).toBeGreaterThanOrEqual(WINDOW - 2);
    });

    test('a new window starts with the whole budget', async () => {
        const budget = new WindowBudget(2, WINDOW);
        await budget.run(2, ok);
        await Bun.sleep(WINDOW + 5);
        const started = performance.now();
        await budget.run(2, ok);
        expect(performance.now() - started).toBeLessThan(20);
    });

    test('a failed request still times the window', async () => {
        const budget = new WindowBudget(1, WINDOW);
        await expect(
            budget.run(1, async () => {
                throw new Error('HTTP 500');
            })
        ).rejects.toThrow('HTTP 500');
        const started = performance.now();
        await budget.run(1, ok);
        expect(performance.now() - started).toBeGreaterThanOrEqual(WINDOW - 2);
    });

    test('a wait past maxWaitMs fails at once as "server busy"', async () => {
        const budget = new WindowBudget(1, 10_000, 1_000);
        await budget.run(1, ok);
        await expect(budget.run(1, ok)).rejects.toThrow('server busy');
    });

    // the window's end isn't known until its first request settles
    test('past the budget while the first request is still out, a request fails as "server busy"', async () => {
        const budget = new WindowBudget(1, WINDOW);
        const first = budget.run(1, () => Bun.sleep(20));
        await expect(budget.run(1, ok)).rejects.toThrow('server busy');
        await first;
    });

    test('exhaust() holds every request until the window ends', async () => {
        const budget = new WindowBudget(10, WINDOW);
        await budget.run(1, async () => budget.exhaust());
        const started = performance.now();
        await budget.run(1, ok);
        expect(performance.now() - started).toBeGreaterThanOrEqual(WINDOW - 10);
    });

    test('a request whose caller gives up stops waiting', async () => {
        const budget = new WindowBudget(1, 10_000);
        await budget.run(1, ok);
        const controller = new AbortController();
        const waiting = budget.run(1, ok, controller.signal);
        // the 10 s wait is under maxWaitMs, so without the abort it would sleep through it
        controller.abort(new Error('gave up'));
        await expect(waiting).rejects.toThrow('gave up');
    });

    test('an already aborted request never starts', async () => {
        const budget = new WindowBudget(1, WINDOW);
        let ran = false;
        await expect(
            budget.run(
                1,
                async () => (ran = true),
                AbortSignal.abort(new Error('gave up'))
            )
        ).rejects.toThrow('gave up');
        expect(ran).toBe(false);
    });
});
