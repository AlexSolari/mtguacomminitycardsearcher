// GinCardSearcher on saved pages served by a fake client: which requests it sends (MTGin's batching) and what it
// does with the answers.
import { describe, expect, test } from 'bun:test';
import { BATCH_WINDOW_MS } from '@/server/outbound/batcher';
import { HttpError, ShopClient } from '@/server/outbound/shop-client';
import { GinCardSearcher } from '@/server/searchers/gin-card-searcher';
import { captureLogs } from '../capture-logs';

const logs = captureLogs();

describe('GinCardSearcher', () => {
    const base = 'https://mtgin.kyiv.ua';
    const apiUrl = `${base}/api/public/v1/search`;
    const real = new ShopClient(base);

    // one in-stock offer per looked-up name
    const offers = (names: string[]) => ({
        currency: 'UAH',
        results: names.map((name, i) => ({
            query: { name },
            offers: [
                {
                    name,
                    setName: 'Nemesis',
                    collectorNumber: String(i + 1),
                    language: 'en',
                    finish: 'nonfoil',
                    condition: 'normal',
                    signed: false,
                    quantity: 1,
                    priceUah: 100 + i,
                    url: `/shops/mtgin/cards/${i}`,
                    imageUrl: null
                }
            ]
        }))
    });

    // A client whose POSTs are answered by `answer` (by default, one offer per name). `requests` records each
    // request's URL, options and the names it looked up.
    function fakeGin(
        answer: (names: string[], init: RequestInit) => unknown = offers
    ) {
        const requests: { url: string; init: RequestInit; names: string[] }[] =
            [];
        const client = {
            baseUrl: base,
            url: real.url.bind(real),
            fetchJson: async (url: string, init: RequestInit) => {
                const names = JSON.parse(init.body as string).cards.map(
                    (c: { name: string }) => c.name
                );
                requests.push({ url, init, names });
                return answer(names, init);
            }
        } as unknown as ShopClient;
        return { client, requests };
    }

    // a request that only answers once released, or rejects when its signal aborts
    function heldRequest() {
        const held = Promise.withResolvers<void>();
        const answer = async (names: string[], init: RequestInit) => {
            await new Promise<void>((resolve, reject) => {
                held.promise.then(resolve);
                init.signal?.addEventListener('abort', () =>
                    reject(init.signal!.reason)
                );
            });
            return offers(names);
        };
        return { answer, release: () => held.resolve() };
    }

    // long enough for the batch window to pass and the request to go out
    const waitForBatch = () => Bun.sleep(BATCH_WINDOW_MS + 20);

    // the key allows 60 requests a minute for all our users together
    test('sends at most one request a second', () => {
        const { client } = new GinCardSearcher() as unknown as {
            client: { baseUrl: string; intervalMs: number };
        };
        expect(client.baseUrl).toBe(base);
        expect(client.intervalMs).toBe(1000);
    });

    test('POSTs the lookup with the key and parses the offers', async () => {
        const { client, requests } = fakeGin();
        const results = await new GinCardSearcher(client, 'test-key').search(
            'Daze',
            new AbortController().signal
        );
        expect(results).toEqual([
            expect.objectContaining({
                shop: 'gin',
                name: 'Daze — Nemesis #1',
                url: `${base}/shops/mtgin/cards/0`,
                price: 100,
                stock: 1
            })
        ]);
        expect(requests).toHaveLength(1);
        expect(requests[0]!.url).toBe(apiUrl);
        expect(requests[0]!.init).toMatchObject({
            method: 'POST',
            headers: {
                Authorization: 'Bearer test-key',
                'Content-Type': 'application/json'
            }
        });
        expect(JSON.parse(requests[0]!.init.body as string)).toEqual({
            cards: [{ name: 'Daze' }]
        });
    });

    test('searches that arrive together share one request, each getting its own offers', async () => {
        const { client, requests } = fakeGin();
        const gin = new GinCardSearcher(client, 'test-key');
        const [daze, sol] = await Promise.all([
            gin.search('Daze'),
            gin.search('Sol Ring')
        ]);
        expect(requests.map((r) => r.names)).toEqual([['Daze', 'Sol Ring']]);
        expect(daze!.map((r) => r.name)).toEqual(['Daze — Nemesis #1']);
        expect(sol!.map((r) => r.name)).toEqual(['Sol Ring — Nemesis #2']);
    });

    // paired by the name each answer echoes, not by position (see pairAnswers)
    test('answers out of order still reach their own searches', async () => {
        const { client } = fakeGin((names) => {
            const answer = offers(names);
            answer.results.reverse();
            return answer;
        });
        const gin = new GinCardSearcher(client, 'test-key');
        const [daze, sol] = await Promise.all([
            gin.search('Daze'),
            gin.search('Sol Ring')
        ]);
        expect(daze!.map((r) => r.name)).toEqual(['Daze — Nemesis #1']);
        expect(sol!.map((r) => r.name)).toEqual(['Sol Ring — Nemesis #2']);
    });

    // a search's first cards (see searchHandler) skip the batch window
    test('an urgent search is sent without waiting for the batch window', async () => {
        const { client, requests } = fakeGin();
        const gin = new GinCardSearcher(client, 'test-key');
        const daze = gin.search('Daze', undefined, undefined, true);
        await Bun.sleep(5);
        expect(requests.map((r) => r.names)).toEqual([['Daze']]);
        await daze;
    });

    test('searches arriving while a request is out go in the next one', async () => {
        const { answer, release } = heldRequest();
        const { client, requests } = fakeGin(answer);
        const gin = new GinCardSearcher(client, 'test-key');
        const first = gin.search('Daze');
        await waitForBatch();
        const later = [gin.search('Sol Ring'), gin.search('Opt')];
        await waitForBatch();
        expect(requests).toHaveLength(1); // only one request in flight
        release();
        await Promise.all([first, ...later]);
        expect(requests.map((r) => r.names)).toEqual([
            ['Daze'],
            ['Sol Ring', 'Opt']
        ]);
    });

    test('more than 100 searches are split into requests of 100', async () => {
        const { client, requests } = fakeGin();
        const gin = new GinCardSearcher(client, 'test-key');
        const names = Array.from({ length: 150 }, (_, i) => `Card ${i}`);
        const results = await Promise.all(names.map((n) => gin.search(n)));
        expect(requests.map((r) => r.names.length)).toEqual([100, 50]);
        expect(results[120]![0]!.name).toStartWith('Card 120 — ');
    });

    test('a failed request fails every search in it', async () => {
        const { client } = fakeGin(() => {
            throw new HttpError(429);
        });
        const gin = new GinCardSearcher(client, 'test-key');
        const settled = await Promise.allSettled([
            gin.search('Daze'),
            gin.search('Opt')
        ]);
        expect(
            settled.map((s) => s.status === 'rejected' && s.reason.message)
        ).toEqual(['HTTP 429', 'HTTP 429']);
    });

    test('a lookup with nothing in stock gives [], quietly', async () => {
        const { client } = fakeGin(() => ({ results: [{ offers: [] }] }));
        expect(
            await new GinCardSearcher(client, 'test-key').search('Daze')
        ).toEqual([]);
        expect(logs).toEqual([]);
    });

    test('without a key it fails without a request', async () => {
        const { client, requests } = fakeGin();
        await expect(
            new GinCardSearcher(client, '').search('Daze')
        ).rejects.toThrow('MTGIN_API_KEY is not set');
        expect(requests).toHaveLength(0);
    });

    test('an already aborted search rejects at once', async () => {
        const { client, requests } = fakeGin();
        const controller = new AbortController();
        controller.abort(new Error('gone'));
        await expect(
            new GinCardSearcher(client, 'test-key').search(
                'Daze',
                controller.signal
            )
        ).rejects.toThrow('gone');
        expect(requests).toHaveLength(0);
    });

    test('a search abandoned before sending leaves its batch', async () => {
        const { client, requests } = fakeGin();
        const gin = new GinCardSearcher(client, 'test-key');
        const controller = new AbortController();
        const abandoned = gin.search('Daze', controller.signal);
        const kept = gin.search('Opt');
        controller.abort(new Error('gone'));
        await expect(abandoned).rejects.toThrow('gone');
        expect((await kept).map((r) => r.name)).toEqual(['Opt — Nemesis #1']);
        expect(requests.map((r) => r.names)).toEqual([['Opt']]);
    });

    test('a sent request is aborted only when every search in it gives up', async () => {
        const { answer, release } = heldRequest();
        const { client, requests } = fakeGin(answer);
        const gin = new GinCardSearcher(client, 'test-key');
        const a = new AbortController();
        const b = new AbortController();
        const first = gin.search('Daze', a.signal);
        const second = gin.search('Opt', b.signal);
        await waitForBatch();
        const signal = requests[0]!.init.signal!;

        a.abort(new Error('a gone'));
        await expect(first).rejects.toThrow('a gone');
        expect(signal.aborted).toBe(false); // Opt still wants the answer

        b.abort(new Error('b gone'));
        await expect(second).rejects.toThrow('b gone');
        expect(signal.aborted).toBe(true);
        release();
    });
});
