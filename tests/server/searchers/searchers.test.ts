// Every searcher, on saved pages served by a fake client: which URLs it asks for, and what it does with the
// answers (MTGin's batching, CartOn's next pages and full offer lists, fallbacks when they fail).
import { describe, expect, test } from 'bun:test';
import { BATCH_WINDOW_MS } from '@/server/outbound/batcher';
import {
    HttpError,
    ShopClient,
    ShopRequestError
} from '@/server/outbound/shop-client';
import { parseManavault } from '@/server/parsers/api/manavault';
import {
    CartonCardSearcher,
    ALL_OFFERS,
    MAX_OFFER_PAGES,
    MAX_SEARCH_PAGES,
    OFFERS_PER_PRODUCT,
    PRODUCTS_PER_PAGE
} from '@/server/searchers/carton-card-searcher';
import { CitadelCardSearcher } from '@/server/searchers/citadel-card-searcher';
import { GinCardSearcher } from '@/server/searchers/gin-card-searcher';
import { KartotekaCardSearcher } from '@/server/searchers/kartoteka-card-searcher';
import { MagicswampCardSearcher } from '@/server/searchers/magicswamp-card-searcher';
import {
    ManavaultCardSearcher,
    manavaultSource
} from '@/server/searchers/manavault-card-searcher';
import { NerdikCardSearcher } from '@/server/searchers/nerdik-card-searcher';
import { PaytowinCardSearcher } from '@/server/searchers/paytowin-card-searcher';
import type { WindowBudget } from '@/server/outbound/window-budget';
import { captureLogs } from '../capture-logs';

const fixture = (name: string) =>
    Bun.file(new URL(`../../fixtures/${name}`, import.meta.url)).text();

// A ShopClient that answers from `pages` (URL → body, or an error to throw) and fails on any other URL.
// `requests` records each URL with the options it was fetched with.
function fakeClient(baseUrl: string, pages: Record<string, string | Error>) {
    const real = new ShopClient(baseUrl);
    const requests: { url: string; init?: RequestInit }[] = [];
    const answer = (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        const page = pages[url];
        if (page === undefined) throw new Error(`unexpected request: ${url}`);
        if (page instanceof Error) throw page;
        return page;
    };
    const client = {
        baseUrl,
        url: real.url.bind(real),
        fetchHtml: async (url: string, init?: RequestInit) => answer(url, init),
        fetchJson: async (url: string, init?: RequestInit) =>
            JSON.parse(answer(url, init))
    } as unknown as ShopClient;
    return { client, requests, requested: () => requests.map((r) => r.url) };
}

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

describe('CartonCardSearcher', () => {
    const base = 'https://carton.cards';
    const apiUrl = `${base}/graphql`;
    const real = new ShopClient(base);

    type Variables = Record<string, string | null>;

    // A client whose POSTs to /graphql are answered by `answer`, given the query's variables (a search's
    // `search` and `after`; a printing's offers' `search` and `expansion`). `requests` records each one.
    function fakeCarton(
        answer: (variables: Variables) => unknown | Promise<unknown>
    ) {
        const requests: {
            url: string;
            init: RequestInit;
            variables: Variables;
        }[] = [];
        const client = {
            baseUrl: base,
            url: real.url.bind(real),
            fetchJson: async (url: string, init: RequestInit) => {
                const { variables } = JSON.parse(init.body as string);
                requests.push({ url, init, variables });
                return answer(variables);
            }
        } as unknown as ShopClient;
        return { client, requests };
    }

    // a printing with `offers` offers, one hryvnia apart
    const product = (name: string, offers = 1) => ({
        name,
        url: `${base}/magic-the-gathering/singles/${encodeURIComponent(name)}`,
        imageUrl: null,
        expansion: { name: 'Some Set (SET)', slug: `set-${name.length}` },
        offers: {
            nodes: Array.from({ length: offers }, (_, i) => ({
                amount: 1,
                price: 100 + i,
                attributes: []
            }))
        }
    });
    // a search page, naming the next page's cursor when there is one
    const page = (nodes: object[], endCursor: string | null = null) => ({
        data: {
            products: {
                pageInfo: { hasNextPage: endCursor !== null, endCursor },
                nodes
            }
        }
    });

    const searcher = (client: ShopClient) =>
        new CartonCardSearcher(client, 'test-key');

    // the key allows 120 requests a minute for all our users together
    test('sends at most two requests a second', () => {
        const { client } = new CartonCardSearcher() as unknown as {
            client: { baseUrl: string; intervalMs: number };
        };
        expect(client.baseUrl).toBe(base);
        expect(client.intervalMs).toBe(500);
    });

    test('without a key, fails without a request', async () => {
        const { client, requests } = fakeCarton(() => page([]));
        await expect(
            new CartonCardSearcher(client, '').search('Opt')
        ).rejects.toThrow('CARTON_API_KEY is not set');
        expect(requests).toEqual([]);
    });

    test('searches Magic singles with the key, and parses the offers', async () => {
        const { client, requests } = fakeCarton(() =>
            page([product('Opt (M21-59)'), product('Thopter Engineer')])
        );
        const signal = new AbortController().signal;
        const results = await searcher(client).search('Opt', signal);
        expect(requests).toHaveLength(1);
        const { url, init, variables } = requests[0]!;
        expect(url).toBe(apiUrl);
        expect(variables).toEqual({ search: 'Opt', after: null });
        expect(init).toMatchObject({
            method: 'POST',
            headers: {
                Authorization: 'Bearer test-key',
                'Content-Type': 'application/json'
            },
            signal
        });
        const { query } = JSON.parse(init.body as string);
        expect(query).toContain(
            'universeSlug: "magic-the-gathering", productTypeSlug: "singles"'
        );
        expect(query).toContain(`first: ${PRODUCTS_PER_PAGE}`);
        expect(query).toContain(`offers(first: ${OFFERS_PER_PRODUCT})`);
        // fuzzy matches are kept, as "other matches"
        expect(results.map((r) => r.name)).toEqual([
            'Opt (M21-59)',
            'Thopter Engineer'
        ]);
        expect(logs).toEqual([]);
    });

    // "Opt" matches 22 products, and its own printings can be on any page
    test('reads the next pages, up to MAX_SEARCH_PAGES', async () => {
        const { client, requests } = fakeCarton(({ after }) => {
            const n = after === null ? 1 : Number(after) + 1;
            return page([product(`Thopter ${n}`)], String(n));
        });
        const results = await searcher(client).search('Opt');
        expect(requests.map((r) => r.variables.after)).toEqual([
            null,
            ...Array.from({ length: MAX_SEARCH_PAGES - 1 }, (_, i) =>
                String(i + 1)
            )
        ]);
        expect(results).toHaveLength(MAX_SEARCH_PAGES);
        expect(logs).toEqual([]);
    });

    test('a failed next page keeps the earlier pages, and is logged', async () => {
        const { client } = fakeCarton(({ after }) => {
            if (after) throw new HttpError(503);
            return page([product('Opt (M21-59)')], 'next');
        });
        const results = await searcher(client).search('Opt');
        expect(results.map((r) => r.name)).toEqual(['Opt (M21-59)']);
        expect(logs).toMatchObject([
            {
                message: 'follow-up request failed, keeping search results',
                url: apiUrl
            }
        ]);
    });

    test('a failed first page fails the card', async () => {
        const { client } = fakeCarton(() => {
            throw new HttpError(401);
        });
        await expect(searcher(client).search('Opt')).rejects.toThrow(
            'HTTP 401'
        );
    });

    // GraphQL refuses a query (too complex, a bad cursor) with a 200 and `errors`
    test('a GraphQL error fails the card, with the errors for the logs', async () => {
        const errors = [{ message: 'Query has complexity of 601' }];
        const { client } = fakeCarton(() => ({ data: null, errors }));
        const failure = await searcher(client)
            .search('Opt')
            .catch((err) => err);
        expect(failure).toBeInstanceOf(ShopRequestError);
        expect(failure).toMatchObject({
            message: 'API error',
            url: apiUrl,
            body: JSON.stringify(errors)
        });
    });

    test('a missing or malformed answer finds nothing', async () => {
        const { client } = fakeCarton(() => ({ data: { products: null } }));
        expect(await searcher(client).search('Opt')).toEqual([]);
    });

    describe('an exact printing whose first page of offers is full', () => {
        const full = (name: string) => product(name, OFFERS_PER_PRODUCT);

        test('gets all its offers, searched by its name within its set', async () => {
            const exact = full('Opt (M21-59)');
            const { client, requests } = fakeCarton((v) =>
                v.expansion
                    ? {
                          data: {
                              products: {
                                  nodes: [
                                      product('Opt (M21-60)', 1),
                                      product('Opt (M21-59)', 8)
                                  ]
                              }
                          }
                      }
                    : page([exact, full('Thopter Engineer')])
            );
            const signal = new AbortController().signal;
            const results = await searcher(client).search('Opt', signal);
            // the fuzzy match isn't followed up
            expect(requests.map((r) => r.variables)).toEqual([
                { search: 'Opt', after: null },
                { search: 'Opt (M21-59)', expansion: exact.expansion.slug }
            ]);
            expect(requests[1]!.init.signal).toBe(signal);
            expect(
                JSON.parse(requests[1]!.init.body as string).query
            ).toContain(`offers(first: ${ALL_OFFERS})`);
            const names = results.map((r) => r.name);
            expect(names.filter((n) => n === 'Opt (M21-59)')).toHaveLength(8);
            expect(names.filter((n) => n === 'Thopter Engineer')).toHaveLength(
                OFFERS_PER_PRODUCT
            );
            expect(logs).toEqual([]);
        });

        test(`for at most MAX_OFFER_PAGES printings a search`, async () => {
            const { client, requests } = fakeCarton((v) =>
                v.expansion
                    ? { data: { products: { nodes: [] } } }
                    : page(
                          Array.from({ length: MAX_OFFER_PAGES + 2 }, (_, i) =>
                              full(`Opt (S${i}-1)`)
                          )
                      )
            );
            const results = await searcher(client).search('Opt');
            expect(requests).toHaveLength(1 + MAX_OFFER_PAGES);
            // a follow-up that doesn't find the printing keeps its first page
            expect(results).toHaveLength(
                (MAX_OFFER_PAGES + 2) * OFFERS_PER_PRODUCT
            );
        });

        test('a failed follow-up keeps the first page, and is logged', async () => {
            const exact = full('Opt (M21-59)');
            const { client } = fakeCarton((v) => {
                if (v.expansion) throw new HttpError(500);
                return page([exact]);
            });
            const results = await searcher(client).search('Opt');
            expect(results).toHaveLength(OFFERS_PER_PRODUCT);
            expect(logs).toMatchObject([
                {
                    message: 'follow-up request failed, keeping search results',
                    url: exact.url
                }
            ]);
        });

        test('an aborted search rejects instead of falling back', async () => {
            const controller = new AbortController();
            const err = new DOMException('aborted', 'AbortError');
            const { client } = fakeCarton((v) => {
                if (!v.expansion) return page([full('Opt (M21-59)')]);
                controller.abort(err);
                throw err;
            });
            await expect(
                searcher(client).search('Opt', controller.signal)
            ).rejects.toBe(err);
        });
    });
});

// The single-request searchers: they ask for the right URL, pass the caller's signal on, and parse the answer.
describe('single-request searchers', () => {
    test('KartotekaCardSearcher', async () => {
        const url = 'https://kartoteka.in.ua/ua/search/?q=Sol+Ring';
        const { client, requested } = fakeClient('https://kartoteka.in.ua', {
            [url]: await fixture('kartoteka-search.html')
        });
        const results = await new KartotekaCardSearcher(client).search(
            'Sol Ring'
        );
        expect(results.length).toBeGreaterThan(0);
        expect(requested()).toEqual([url]);
    });

    test('PaytowinCardSearcher', async () => {
        const url =
            'https://api.paytowin.club/auctions?q=Raucous+Theater&game=magic&limit=50';
        const { client, requested } = fakeClient('https://api.paytowin.club', {
            [url]: await fixture('paytowin-auctions.json')
        });
        const results = await new PaytowinCardSearcher(client).search(
            'Raucous Theater'
        );
        expect(results.length).toBeGreaterThan(0);
        expect(requested()).toEqual([url]);
    });

    test('MagicswampCardSearcher', async () => {
        const url =
            'https://magicswamp.com.ua/api/listings/grouped/cards?game=mtg&search=Sol+Ring&limit=100';
        const { client, requests } = fakeClient('https://magicswamp.com.ua', {
            [url]: await fixture('magicswamp-search.json')
        });
        const signal = new AbortController().signal;
        const results = await new MagicswampCardSearcher(client).search(
            'Sol Ring',
            signal
        );
        expect(results.length).toBeGreaterThan(0);
        expect(requests).toEqual([{ url, init: { signal } }]);
        expect(logs).toEqual([]);
    });

    // the API allows 300 requests a minute for all our users together
    test('MagicswampCardSearcher stays under 300 requests a minute', () => {
        const { client } = new MagicswampCardSearcher() as unknown as {
            client: { baseUrl: string; intervalMs: number };
        };
        expect(client.baseUrl).toBe('https://magicswamp.com.ua');
        expect(client.intervalMs).toBe(220);
    });

    test('MagicswampCardSearcher logs an error when results span several pages', async () => {
        const url =
            'https://magicswamp.com.ua/api/listings/grouped/cards?game=mtg&search=Opt&limit=100';
        const page = JSON.parse(await fixture('magicswamp-search.json'));
        const { client } = fakeClient('https://magicswamp.com.ua', {
            [url]: JSON.stringify({ ...page, total: 150, totalPages: 2 })
        });
        const results = await new MagicswampCardSearcher(client).search('Opt');
        expect(results.length).toBeGreaterThan(0);
        expect(logs).toMatchObject([
            {
                level: 'error',
                message: 'magicswamp results span several pages',
                shop: 'magicswamp',
                card: 'Opt',
                total: 150,
                totalPages: 2
            }
        ]);
    });

    test('CitadelCardSearcher', async () => {
        const url = 'https://citadel.kyiv.ua/singles?q=Sol+Ring';
        const { client, requests } = fakeClient('https://citadel.kyiv.ua', {
            [url]: await fixture('citadel-search.html')
        });
        const signal = new AbortController().signal;
        const results = await new CitadelCardSearcher(client).search(
            'Sol Ring',
            signal
        );
        expect(results.length).toBeGreaterThan(0);
        expect(requests).toEqual([{ url, init: { signal } }]);
    });
});

describe('ManavaultCardSearcher', () => {
    const base = 'https://manavaultstore.com';
    const apiUrl = `${base}/api/v1/prices`;
    const real = new ShopClient(base);

    // one in-stock row per looked-up name
    const answers = (cards: string[]) => ({
        answers: cards.map((name, i) => ({
            query: name.toLowerCase(),
            match: 'exact',
            results: [
                {
                    name,
                    setName: 'Nemesis',
                    number: String(i + 1),
                    url: `${base}/cards/${i}`,
                    price: 100 + i,
                    stock: 1
                }
            ]
        }))
    });

    // A client whose POSTs are answered by `answer` (by default, one row per name). `requests` records each
    // request's URL, options and body.
    function fakeManavault(answer: (cards: string[]) => unknown = answers) {
        const requests: {
            url: string;
            init: RequestInit;
            body: { cards: string[]; source: string };
        }[] = [];
        const client = {
            baseUrl: base,
            url: real.url.bind(real),
            fetchJson: async (url: string, init: RequestInit) => {
                const body = JSON.parse(init.body as string);
                requests.push({ url, init, body });
                return answer(body.cards);
            }
        } as unknown as ShopClient;
        return { client, requests };
    }

    // The minute's budget (WindowBudget) is what keeps us within the API's limit; the client keeps the usual spacing.
    test('uses the default client spacing and a budget of 55 requests per 61 s', () => {
        const { client, budget } = new ManavaultCardSearcher() as unknown as {
            client: { baseUrl: string; intervalMs: number };
            budget: { capacity: number; windowMs: number };
        };
        expect(client.baseUrl).toBe(base);
        expect(client.intervalMs).toBe(200);
        expect(budget).toMatchObject({ capacity: 55, windowMs: 61_000 });
    });

    // A budget that records what each request was charged.
    function recordingBudget() {
        const costs: number[] = [];
        let exhausted = false;
        const budget = {
            run: (cost: number, fn: () => Promise<unknown>) => {
                costs.push(cost);
                return fn();
            },
            exhaust: () => (exhausted = true)
        } as unknown as WindowBudget;
        return { budget, costs, exhausted: () => exhausted };
    }

    test('each request is charged a request per 10 names', async () => {
        const { client, requests } = fakeManavault();
        const { budget, costs } = recordingBudget();
        const mv = new ManavaultCardSearcher(client, 'test', budget);
        const names = Array.from({ length: 61 }, (_, i) => `Card ${i}`);
        await Promise.all(names.map((n) => mv.search(n)));
        expect(requests.map((r) => r.body.cards.length)).toEqual([50, 11]);
        expect(costs).toEqual([5, 2]);
    });

    test('a 429 spends the rest of the minute', async () => {
        const { client } = fakeManavault(() => {
            throw new HttpError(429);
        });
        const { budget, exhausted } = recordingBudget();
        await expect(
            new ManavaultCardSearcher(client, 'test', budget).search('Daze')
        ).rejects.toThrow('HTTP 429');
        expect(exhausted()).toBe(true);
    });

    test('another failure leaves the budget alone', async () => {
        const { client } = fakeManavault(() => {
            throw new HttpError(503);
        });
        const { budget, exhausted } = recordingBudget();
        await expect(
            new ManavaultCardSearcher(client, 'test', budget).search('Daze')
        ).rejects.toThrow('HTTP 503');
        expect(exhausted()).toBe(false);
    });

    test('POSTs the name with its source and parses the answer', async () => {
        const body = await fixture('manavault-search.json');
        const { client, requests } = fakeManavault(() => ({
            answers: [JSON.parse(body)]
        }));
        const results = await new ManavaultCardSearcher(
            client,
            'example.up.railway.app'
        ).search('Counterspell', new AbortController().signal);
        expect(results).toEqual(parseManavault(JSON.parse(body)));
        expect(results.length).toBeGreaterThan(0);
        expect(requests).toHaveLength(1);
        expect(requests[0]!.url).toBe(apiUrl);
        expect(requests[0]!.init).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        expect(requests[0]!.body).toEqual({
            cards: ['Counterspell'],
            source: 'example.up.railway.app'
        });
    });

    test('searches that arrive together share one request, each getting its own answer', async () => {
        const { client, requests } = fakeManavault();
        const mv = new ManavaultCardSearcher(client, 'test');
        const [daze, sol] = await Promise.all([
            mv.search('Daze'),
            mv.search('Sol Ring')
        ]);
        expect(requests.map((r) => r.body.cards)).toEqual([
            ['Daze', 'Sol Ring']
        ]);
        expect(daze!.map((r) => r.name)).toEqual(['Daze — Nemesis #1']);
        expect(sol!.map((r) => r.name)).toEqual(['Sol Ring — Nemesis #2']);
    });

    test('more than 50 searches are split into requests of 50', async () => {
        const { client, requests } = fakeManavault();
        const mv = new ManavaultCardSearcher(client, 'test');
        const names = Array.from({ length: 120 }, (_, i) => `Card ${i}`);
        const results = await Promise.all(names.map((n) => mv.search(n)));
        expect(requests.map((r) => r.body.cards.length)).toEqual([50, 50, 20]);
        expect(results[77]![0]!.name).toStartWith('Card 77 — ');
    });

    test("a name the API rejects fails only that name's search", async () => {
        const { client } = fakeManavault((cards) => ({
            answers: cards.map((name) =>
                name.length < 2
                    ? {
                          query: name,
                          match: 'none',
                          results: [],
                          error: 'Назва коротша за 2 літери'
                      }
                    : answers([name]).answers[0]
            )
        }));
        const mv = new ManavaultCardSearcher(client, 'test');
        const [bad, good] = await Promise.allSettled([
            mv.search('X'),
            mv.search('Daze')
        ]);
        expect(bad).toMatchObject({
            status: 'rejected',
            reason: { message: 'Назва коротша за 2 літери' }
        });
        expect(good).toMatchObject({
            status: 'fulfilled',
            value: [expect.objectContaining({ name: 'Daze — Nemesis #1' })]
        });
    });

    test('a name with no match gives [], quietly', async () => {
        const { client } = fakeManavault(() => ({
            answers: [{ query: 'Daze', match: 'none', results: [] }]
        }));
        const mv = new ManavaultCardSearcher(client, 'test');
        expect(await mv.search('Daze')).toEqual([]);
        expect(logs).toEqual([]);
    });

    // not [], which would read as "not in stock" (and be cached as such); see pairAnswers
    test("a name the API didn't answer fails, the rest keep their answers", async () => {
        const { client } = fakeManavault((cards) => answers(cards.slice(1)));
        const mv = new ManavaultCardSearcher(client, 'test');
        const [daze, sol] = await Promise.allSettled([
            mv.search('Daze'),
            mv.search('Sol Ring')
        ]);
        expect(daze).toMatchObject({
            status: 'rejected',
            reason: { message: 'no answer for this card' }
        });
        expect(sol).toMatchObject({
            status: 'fulfilled',
            value: [expect.objectContaining({ name: 'Sol Ring — Nemesis #1' })]
        });
    });

    test('a failed request fails every search in it', async () => {
        const { client } = fakeManavault(() => {
            throw new HttpError(429);
        });
        const mv = new ManavaultCardSearcher(client, 'test');
        const settled = await Promise.allSettled([
            mv.search('Daze'),
            mv.search('Opt')
        ]);
        expect(
            settled.map((s) => s.status === 'rejected' && s.reason.message)
        ).toEqual(['HTTP 429', 'HTTP 429']);
    });

    test("its source is Railway's public domain, else a fixed name", () => {
        const saved = process.env.RAILWAY_PUBLIC_DOMAIN;
        try {
            process.env.RAILWAY_PUBLIC_DOMAIN = 'example.up.railway.app';
            expect(manavaultSource()).toBe('example.up.railway.app');
            delete process.env.RAILWAY_PUBLIC_DOMAIN;
            expect(manavaultSource()).toBe('mtg-ua-card-searcher');
        } finally {
            if (saved === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN;
            else process.env.RAILWAY_PUBLIC_DOMAIN = saved;
        }
    });
});

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
