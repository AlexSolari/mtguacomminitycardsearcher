// The batching itself is exercised through GinCardSearcher (tests/server/searchers/searchers.test.ts): aborts,
// failures and requests held in flight. These cover what's generic about it.
import { describe, expect, test } from 'bun:test';
import { Batcher } from '@/server/batcher';

describe('Batcher', () => {
    test('items that arrive together go out as one batch, each getting its own result', async () => {
        const batches: string[][] = [];
        const batcher = new Batcher<string, string>(async (items) => {
            batches.push(items);
            return items.map((item) => item.toUpperCase());
        }, 10);
        expect(
            await Promise.all(['a', 'b', 'c'].map((i) => batcher.add(i)))
        ).toEqual(['A', 'B', 'C']);
        expect(batches).toEqual([['a', 'b', 'c']]);
    });

    test('batches hold at most maxBatch items, sent one after another', async () => {
        const batches: number[][] = [];
        let inFlight = 0;
        const batcher = new Batcher<number, number>(async (items) => {
            expect(++inFlight).toBe(1);
            batches.push(items);
            await Bun.sleep(5);
            inFlight--;
            return items;
        }, 2);
        await Promise.all([1, 2, 3, 4, 5].map((i) => batcher.add(i)));
        expect(batches).toEqual([[1, 2], [3, 4], [5]]);
    });

    test("the batch is sent with its own signal, not a caller's", async () => {
        const signals: AbortSignal[] = [];
        const batcher = new Batcher<string, string>(async (items, signal) => {
            signals.push(signal);
            return items;
        }, 10);
        const caller = new AbortController();
        await batcher.add('a', caller.signal);
        expect(signals[0]).not.toBe(caller.signal);
        expect(signals[0]!.aborted).toBe(false);
    });
});
