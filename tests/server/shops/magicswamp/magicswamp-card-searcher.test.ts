// MagicswampCardSearcher on answers served by a fake client: its batches (searched by each card's full name), sorting
// the printings back to their cards, and following the pages.
import { describe, expect, test } from 'bun:test';
import { ShopClient } from '@/server/outbound/shop-client';
import {
    MAX_PAGES,
    MagicswampCardSearcher
} from '@/server/shops/magicswamp/magicswamp-card-searcher';
import type {
    MagicswampCard,
    MagicswampResponse
} from '@/server/shops/magicswamp/magicswamp-parser';
import { fixture } from '../fake-client';
import { captureLogs } from '../../capture-logs';

const logs = captureLogs();
const base = 'https://magicswamp.com.ua';

// A client whose GETs are answered by `answer` (the names asked for and the page). `requests` records each URL,
// its options, and the names and page it asked for.
function fakeSwamp(
    answer: (names: string[], page: number) => MagicswampResponse
) {
    const real = new ShopClient(base);
    const requests: {
        url: string;
        init?: RequestInit;
        names: string[];
        page: number;
    }[] = [];
    const client = {
        baseUrl: base,
        url: real.url.bind(real),
        fetchJson: async (url: string, init?: RequestInit) => {
            const params = new URL(url).searchParams;
            const names = params.getAll('names[]');
            const page = Number(params.get('page'));
            requests.push({ url, init, names, page });
            return answer(names, page);
        }
    } as unknown as ShopClient;
    return { client, requests };
}

const printing = (
    card_name: string,
    card_id = card_name,
    listing_id = `${card_id}-1`
): MagicswampCard => ({
    card_id,
    card_name,
    set_name: 'Foundations',
    card_image_url: null,
    game: 'mtg',
    sellers: [
        {
            listing_id,
            price: 100,
            currency: 'UAH',
            condition: 'near_mint',
            is_foil: false,
            foil_type: 'none',
            quantity: 1,
            language: 'en'
        }
    ]
});

describe('MagicswampCardSearcher', () => {
    test('asks for the names in one request and gives each card its own printings', async () => {
        // the saved page lists one printing each of these, among others
        const { data } = JSON.parse(await fixture('magicswamp-search.json'));
        const { client, requests } = fakeSwamp((names) => {
            const asked = names.map((n) => n.toLowerCase());
            const found = data.filter((c: MagicswampCard) =>
                asked.includes(c.card_name.toLowerCase())
            );
            return { data: found, total: found.length, totalPages: 1 };
        });
        const swamp = new MagicswampCardSearcher(client);
        const [boltwave, treatment, solRing] = await Promise.all([
            swamp.search('Boltwave'),
            // the API ignores case, and so does the sorting back
            swamp.search('ROYAL TREATMENT'),
            swamp.search('Sol Ring')
        ]);
        expect(requests).toHaveLength(1);
        expect(requests[0]!.url).toBe(
            `${base}/api/listings/grouped/cards?game=mtg&names%5B%5D=Boltwave&names%5B%5D=ROYAL+TREATMENT&names%5B%5D=Sol+Ring&limit=100&page=1&sortBy=price_asc`
        );
        expect(requests[0]!.init?.signal).toBeInstanceOf(AbortSignal);
        expect(boltwave!.length).toBeGreaterThan(0);
        expect(boltwave!.every((r) => r.name.startsWith('Boltwave'))).toBe(
            true
        );
        expect(treatment!.length).toBeGreaterThan(0);
        expect(
            treatment!.every((r) => r.name.startsWith('Royal Treatment'))
        ).toBe(true);
        expect(solRing).toEqual([]);
        expect(logs).toEqual([]);
    });

    // the API finds "Turn // Burn" but not "Turn"
    test('looks a card up by its full name', async () => {
        const { client, requests } = fakeSwamp(() => ({
            data: [printing('Turn // Burn')],
            totalPages: 1
        }));
        const results = await new MagicswampCardSearcher(client).search(
            'Turn',
            undefined,
            'Turn // Burn'
        );
        expect(requests[0]!.names).toEqual(['Turn // Burn']);
        expect(results.map((r) => r.name)).toEqual([
            'Turn // Burn — Foundations'
        ]);
    });

    test('a card searched twice at once is asked for once', async () => {
        const { client, requests } = fakeSwamp(() => ({
            data: [printing('Opt')],
            totalPages: 1
        }));
        const swamp = new MagicswampCardSearcher(client);
        const [a, b] = await Promise.all([
            swamp.search('Opt'),
            swamp.search('Opt')
        ]);
        expect(requests[0]!.names).toEqual(['Opt']);
        expect(a).toHaveLength(1);
        expect(b).toEqual(a);
    });

    test('reads every page, and a printing that comes twice counts once', async () => {
        const { client, requests } = fakeSwamp((_names, page) =>
            page === 1
                ? {
                      data: [printing('Forest', 'f1'), printing('Opt', 'o1')],
                      total: 3,
                      totalPages: 2
                  }
                : {
                      // o1 moved down a page while they were read
                      data: [printing('Opt', 'o1'), printing('Forest', 'f2')],
                      total: 3,
                      totalPages: 2
                  }
        );
        const swamp = new MagicswampCardSearcher(client);
        const [forest, opt] = await Promise.all([
            swamp.search('Forest'),
            swamp.search('Opt')
        ]);
        expect(requests.map((r) => r.page)).toEqual([1, 2]);
        expect(forest!.map((r) => r.url)).toEqual([
            `${base}/mtg/listing/f1-1`,
            `${base}/mtg/listing/f2-1`
        ]);
        expect(opt!.map((r) => r.url)).toEqual([`${base}/mtg/listing/o1-1`]);
    });

    test('stops after the last page it reads and logs an error', async () => {
        const { client, requests } = fakeSwamp((_names, page) => ({
            data: [printing('Forest', `f${page}`)],
            total: 1000,
            totalPages: 10
        }));
        const results = await new MagicswampCardSearcher(client).search(
            'Forest'
        );
        expect(requests).toHaveLength(MAX_PAGES);
        expect(results).toHaveLength(MAX_PAGES);
        expect(logs).toMatchObject([
            {
                level: 'error',
                message: 'magicswamp results span too many pages',
                shop: 'magicswamp',
                names: 1,
                total: 1000,
                totalPages: 10
            }
        ]);
    });

    test('nothing in stock is one request and no results', async () => {
        const { client, requests } = fakeSwamp(() => ({
            data: [],
            total: 0,
            totalPages: 0
        }));
        expect(
            await new MagicswampCardSearcher(client).search('Sol Ring')
        ).toEqual([]);
        expect(requests).toHaveLength(1);
        expect(logs).toEqual([]);
    });

    test("a printing under a name that wasn't asked for is logged", async () => {
        const { client } = fakeSwamp(() => ({
            data: [printing('Opt'), printing('Optimus Prime')],
            totalPages: 1
        }));
        const results = await new MagicswampCardSearcher(client).search('Opt');
        expect(results).toHaveLength(1);
        expect(logs).toMatchObject([
            {
                level: 'warn',
                message: "batch answers don't match the request",
                shop: 'magicswamp',
                sent: 1,
                unclaimed: 1
            }
        ]);
    });

    test('a printing the parser chokes on fails only its own card', async () => {
        const { client } = fakeSwamp(() => ({
            data: [
                { ...printing('Daze'), sellers: 'not a list' as never },
                printing('Opt')
            ],
            totalPages: 1
        }));
        const swamp = new MagicswampCardSearcher(client);
        const [daze, opt] = await Promise.allSettled([
            swamp.search('Daze'),
            swamp.search('Opt')
        ]);
        expect(daze.status).toBe('rejected');
        expect(opt.status).toBe('fulfilled');
    });

    // the API allows 300 requests a minute for all our users together
    test('stays under 300 requests a minute', () => {
        const { client } = new MagicswampCardSearcher() as unknown as {
            client: { baseUrl: string; intervalMs: number };
        };
        expect(client.baseUrl).toBe(base);
        expect(client.intervalMs).toBe(220);
    });
});
