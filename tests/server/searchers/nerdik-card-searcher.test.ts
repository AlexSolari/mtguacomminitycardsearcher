// NerdikCardSearcher on answers served by a fake client: its batches, searched by each card's full name, and the
// API key.
import { describe, expect, test } from 'bun:test';
import { ShopClient } from '@/server/outbound/shop-client';
import { NerdikCardSearcher } from '@/server/searchers/nerdik-card-searcher';
import { fixture } from './fake-client';
import { captureLogs } from '../capture-logs';

captureLogs();

describe('NerdikCardSearcher', () => {
    const base = 'https://hub.nerdik.club';
    const real = new ShopClient(base);

    // A client whose POSTs are answered by `answer` (by default, the Counterspell fixture for every name).
    // `requests` records each request's URL, options and parsed body.
    function fakeNerdik(answer?: (names: string[]) => unknown) {
        const requests: {
            url: string;
            init: RequestInit;
            body: {
                game: string;
                limit: number;
                cards: { name: string; quantity: number }[];
            };
        }[] = [];
        const client = {
            baseUrl: base,
            url: real.url.bind(real),
            fetchJson: async (url: string, init: RequestInit) => {
                const body = JSON.parse(init.body as string);
                requests.push({ url, init, body });
                const names = body.cards.map((c: { name: string }) => c.name);
                if (answer) return answer(names);
                const { results } = JSON.parse(
                    await fixture('nerdik-batch.json')
                );
                return { results: names.map(() => results[0]) };
            }
        } as unknown as ShopClient;
        return { client, requests };
    }

    test('POSTs the lookup with the key and parses the offers', async () => {
        const { client, requests } = fakeNerdik();
        const results = await new NerdikCardSearcher(client, 'test-key').search(
            'Counterspell'
        );
        expect(results.length).toBeGreaterThan(0);
        expect(requests).toHaveLength(1);
        const [{ url, init, body }] = requests as [(typeof requests)[0]];
        expect(url).toBe(`${base}/api/singles/search/batch`);
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual({
            'X-API-Key': 'test-key',
            'Content-Type': 'application/json'
        });
        expect(body).toEqual({
            game: 'mtg',
            limit: 60,
            cards: [{ name: 'Counterspell', quantity: 1 }]
        });
    });

    // the API finds "Bonecrusher Giant // Stomp" but not "Bonecrusher Giant"
    test('looks a card up by its full name', async () => {
        const { client, requests } = fakeNerdik(() => ({ results: [{}] }));
        await new NerdikCardSearcher(client, 'test-key').search(
            'Bonecrusher Giant',
            undefined,
            'Bonecrusher Giant // Stomp'
        );
        expect(requests[0]!.body.cards).toEqual([
            { name: 'Bonecrusher Giant // Stomp', quantity: 1 }
        ]);
    });

    test('searches that arrive together share one request, each getting its own result', async () => {
        const { client, requests } = fakeNerdik(() => ({
            results: [
                { name: 'Lightning Bolt', cards: [] },
                JSON.parse(
                    // a result per name, in request order, each echoing its name
                    '{"name":"Daze","cards":[{"name":"Daze","game":"mtg","set_name":"Nemesis","number":"31","language":"en","treatment":"regular","image_url":null,"nerdik_url":"https://nerdik.club/mtg/singles/nem/31/en/","offers":[{"price_uah":"90.00","available_quantity":2,"nerdik_url":null}]}]}'
                )
            ]
        }));
        const nerdik = new NerdikCardSearcher(client, 'test-key');
        const [bolt, daze] = await Promise.all([
            nerdik.search('Lightning Bolt'),
            nerdik.search('Daze')
        ]);
        expect(requests).toHaveLength(1);
        expect(requests[0]!.body.cards.map((c) => c.name)).toEqual([
            'Lightning Bolt',
            'Daze'
        ]);
        expect(bolt).toEqual([]);
        expect(daze!.map((r) => [r.name, r.price])).toEqual([
            ['Daze — Nemesis #31', 90]
        ]);
    });

    test('a result the parser chokes on fails only its own card', async () => {
        const { client } = fakeNerdik(() => ({
            results: [
                { name: 'Daze', cards: 'not a list' },
                { name: 'Opt', cards: [] }
            ]
        }));
        const nerdik = new NerdikCardSearcher(client, 'test-key');
        const [daze, opt] = await Promise.allSettled([
            nerdik.search('Daze'),
            nerdik.search('Opt')
        ]);
        expect(daze.status).toBe('rejected');
        expect(opt).toEqual({ status: 'fulfilled', value: [] });
    });

    test('without a key it fails without a request', async () => {
        const { client, requests } = fakeNerdik();
        await expect(
            new NerdikCardSearcher(client, '').search('Counterspell')
        ).rejects.toThrow('NERDIK_API_KEY is not set');
        expect(requests).toHaveLength(0);
    });
});
