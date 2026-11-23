// CartonCardSearcher on answers from a fake client: lookups batched as aliases, next pages and full offer lists,
// and fallbacks when they fail.
import { describe, expect, test } from 'bun:test';
import {
    HttpError,
    ShopClient,
    ShopRequestError
} from '@/server/outbound/shop-client';
import {
    CartonCardSearcher,
    ALL_OFFERS,
    complexity,
    FIRST_PAGE_PRODUCTS,
    MAX_COMPLEXITY,
    MAX_OFFER_PAGES,
    MAX_SEARCH_PAGES,
    NEXT_PAGE_PRODUCTS,
    OFFERS_PER_PRODUCT
} from '@/server/shops/carton/carton-card-searcher';
import { captureLogs } from '../../capture-logs';

const logs = captureLogs();

describe('CartonCardSearcher', () => {
    const base = 'https://carton.cards';
    const apiUrl = `${base}/graphql`;
    const real = new ShopClient(base);

    // a lookup as the fake reads it back from a request's alias: a search page's `after` and `first`, or a
    // printing's `expansion`
    type Lookup = {
        search: string;
        after?: string | null;
        first?: number;
        expansion?: string;
    };

    // A client whose POSTs to /graphql are answered by `respond`, given the lookups in the request (from its
    // variables and query). `requests` records each one.
    function fakeClient(
        respond: (lookups: Lookup[]) => unknown | Promise<unknown>
    ) {
        const requests: {
            url: string;
            init: RequestInit;
            lookups: Lookup[];
        }[] = [];
        const client = {
            baseUrl: base,
            url: real.url.bind(real),
            fetchJson: async (url: string, init: RequestInit) => {
                const { query, variables } = JSON.parse(init.body as string);
                const lookups = Object.keys(variables)
                    .filter((key) => key.startsWith('s'))
                    .map((key): Lookup => {
                        const i = key.slice(1);
                        if (`e${i}` in variables)
                            return {
                                search: variables[key],
                                expansion: variables[`e${i}`]
                            };
                        const first = new RegExp(
                            `c${i}: products\\([^)]*first: (\\d+)`
                        ).exec(query)?.[1];
                        return {
                            search: variables[key],
                            after: variables[`a${i}`],
                            first: Number(first)
                        };
                    });
                requests.push({ url, init, lookups });
                return respond(lookups);
            }
        } as unknown as ShopClient;
        return { client, requests };
    }

    // Each lookup answered by `answer` in its own alias; a throw fails the whole request.
    const fakeCarton = (answer: (lookup: Lookup) => unknown) =>
        fakeClient(async (lookups) => {
            const data: Record<string, unknown> = {};
            for (const [i, lookup] of lookups.entries())
                data[`c${i}`] = await answer(lookup);
            return { data };
        });

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
        pageInfo: { hasNextPage: endCursor !== null, endCursor },
        nodes
    });

    const searcher = (client: ShopClient) =>
        new CartonCardSearcher(client, 'test-key');
    const lookups = (requests: { lookups: Lookup[] }[]) =>
        requests.flatMap((r) => r.lookups);

    // the key allows 120 requests a minute for all our users together
    test('sends at most two requests a second, batched', () => {
        const carton = new CartonCardSearcher();
        const { client } = carton as unknown as {
            client: { baseUrl: string; intervalMs: number };
        };
        expect(client.baseUrl).toBe(base);
        expect(client.intervalMs).toBe(500);
        expect(carton.batched).toBe(true);
    });

    // CartOn refused two pages of 13 products × 5 offers in one query as "complexity of 972", 486 each
    test('scores lookups as CartOn does', () => {
        const firstPage = complexity({
            search: 'Opt',
            after: null,
            first: FIRST_PAGE_PRODUCTS
        });
        const nextPage = complexity({
            search: 'Opt',
            after: 'Mw',
            first: NEXT_PAGE_PRODUCTS
        });
        const offers = complexity({ search: 'Opt', expansion: 'm21' });
        expect(5 + 13 * (7 + 6 * 5)).toBe(486);
        expect([firstPage, nextPage, offers]).toEqual([80, 405, 486]);
        // six first pages to a request, and a next page leaves room for one
        expect(6 * firstPage).toBeLessThanOrEqual(MAX_COMPLEXITY);
        expect(nextPage + firstPage).toBeLessThanOrEqual(MAX_COMPLEXITY);
        expect(offers).toBeLessThanOrEqual(MAX_COMPLEXITY);
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
        const results = await searcher(client).search('Opt');
        expect(requests).toHaveLength(1);
        const { url, init, lookups } = requests[0]!;
        expect(url).toBe(apiUrl);
        expect(lookups).toEqual([
            { search: 'Opt', after: null, first: FIRST_PAGE_PRODUCTS }
        ]);
        expect(init).toMatchObject({
            method: 'POST',
            headers: {
                Authorization: 'Bearer test-key',
                'Content-Type': 'application/json'
            }
        });
        const { query } = JSON.parse(init.body as string);
        expect(query).toContain(
            'universeSlug: "magic-the-gathering", productTypeSlug: "singles"'
        );
        expect(query).toContain(`offers(first: ${OFFERS_PER_PRODUCT})`);
        // fuzzy matches are kept, as "other matches"
        expect(results.map((r) => r.name)).toEqual([
            'Opt (M21-59)',
            'Thopter Engineer'
        ]);
        expect(logs).toEqual([]);
    });

    test('cards searched together share a request, as many as MAX_COMPLEXITY allows', async () => {
        const { client, requests } = fakeCarton(({ search }) =>
            page([product(`${search} (SET-1)`)])
        );
        const carton = searcher(client);
        const cards = ['Opt', 'Daze', 'Ponder', 'Brainstorm', 'Dispel'];
        const more = ['Annul', 'Gut Shot'];
        const results = await Promise.all(
            [...cards, ...more].map((card) => carton.search(card))
        );
        expect(results.map((r) => r[0]!.name)).toEqual(
            [...cards, ...more].map((card) => `${card} (SET-1)`)
        );
        expect(requests.map((r) => r.lookups.map((l) => l.search))).toEqual([
            [...cards, 'Annul'],
            ['Gut Shot']
        ]);
    });

    // "Opt" matches 22 products, and its own printings can be on any page
    test('reads the next pages, in larger pages, up to MAX_SEARCH_PAGES', async () => {
        const { client, requests } = fakeCarton(({ after }) => {
            const n = after === null ? 1 : Number(after) + 1;
            return page([product(`Thopter ${n}`)], String(n));
        });
        const results = await searcher(client).search('Opt');
        expect(lookups(requests)).toEqual([
            { search: 'Opt', after: null, first: FIRST_PAGE_PRODUCTS },
            ...Array.from({ length: MAX_SEARCH_PAGES - 1 }, (_, i) => ({
                search: 'Opt',
                after: String(i + 1),
                first: NEXT_PAGE_PRODUCTS
            }))
        ]);
        expect(results).toHaveLength(MAX_SEARCH_PAGES);
        expect(logs).toEqual([]);
    });

    // the seventh card's first page waits for the next request, and Opt's next page joins it
    test("a card's next page shares a request with other cards' lookups", async () => {
        const { client, requests } = fakeCarton(({ search, after }) =>
            search === 'Opt' && after === null
                ? page([product('Thopter 1')], '1')
                : page([])
        );
        const carton = searcher(client);
        const cards = ['Opt', 'A', 'B', 'C', 'D', 'E', 'F'];
        await Promise.all(cards.map((card) => carton.search(card)));
        expect(requests).toHaveLength(2);
        expect(requests[1]!.lookups).toEqual([
            { search: 'F', after: null, first: FIRST_PAGE_PRODUCTS },
            { search: 'Opt', after: '1', first: NEXT_PAGE_PRODUCTS }
        ]);
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
        // .catch rather than expect().rejects, which Bun 1.4.4 fails here once an earlier test has sent a batch
        const failure = await searcher(client)
            .search('Opt')
            .catch((err) => err);
        expect(failure).toBeInstanceOf(HttpError);
        expect(failure.status).toBe(401);
    });

    // GraphQL refuses a query (too complex, malformed) with a 200 and `errors` that name no alias
    test('a refused query fails every card in it, with the errors for the logs', async () => {
        const errors = [{ message: 'Query has complexity of 601' }];
        const { client } = fakeClient(() => ({ data: null, errors }));
        const carton = searcher(client);
        const failures = await Promise.all(
            ['Opt', 'Daze'].map((card) =>
                carton.search(card).catch((err) => err)
            )
        );
        for (const failure of failures) {
            expect(failure).toBeInstanceOf(ShopRequestError);
            expect(failure).toMatchObject({
                message: 'API error',
                url: apiUrl,
                body: JSON.stringify(errors)
            });
        }
    });

    test("an error in one card's alias fails only that card", async () => {
        const error = { message: 'invalid cursor', path: ['c1'] };
        const { client } = fakeClient(() => ({
            data: { c0: page([product('Opt (M21-59)')]), c1: null },
            errors: [error]
        }));
        const carton = searcher(client);
        const [opt, daze] = await Promise.allSettled(
            ['Opt', 'Daze'].map((card) => carton.search(card))
        );
        expect(opt).toMatchObject({
            status: 'fulfilled',
            value: [{ name: 'Opt (M21-59)' }]
        });
        expect(daze).toMatchObject({
            status: 'rejected',
            reason: { message: 'API error', body: JSON.stringify([error]) }
        });
    });

    test('a missing or malformed answer finds nothing', async () => {
        const { client } = fakeCarton(() => null);
        expect(await searcher(client).search('Opt')).toEqual([]);
        const { client: empty } = fakeClient(() => null);
        expect(await searcher(empty).search('Opt')).toEqual([]);
    });

    describe('an exact printing whose first page of offers is full', () => {
        const full = (name: string) => product(name, OFFERS_PER_PRODUCT);

        test('gets all its offers, searched by its name within its set', async () => {
            const exact = full('Opt (M21-59)');
            const { client, requests } = fakeCarton((l) =>
                l.expansion
                    ? {
                          nodes: [
                              product('Opt (M21-60)', 1),
                              product('Opt (M21-59)', 8)
                          ]
                      }
                    : page([exact, full('Thopter Engineer')])
            );
            const results = await searcher(client).search('Opt');
            // the fuzzy match isn't followed up
            expect(lookups(requests)).toEqual([
                { search: 'Opt', after: null, first: FIRST_PAGE_PRODUCTS },
                { search: 'Opt (M21-59)', expansion: exact.expansion.slug }
            ]);
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
            const { client, requests } = fakeCarton((l) =>
                l.expansion
                    ? { nodes: [] }
                    : page(
                          Array.from({ length: MAX_OFFER_PAGES + 2 }, (_, i) =>
                              full(`Opt (S${i}-1)`)
                          )
                      )
            );
            const results = await searcher(client).search('Opt');
            expect(lookups(requests)).toHaveLength(1 + MAX_OFFER_PAGES);
            // a follow-up that doesn't find the printing keeps its first page
            expect(results).toHaveLength(
                (MAX_OFFER_PAGES + 2) * OFFERS_PER_PRODUCT
            );
        });

        test('a failed follow-up keeps the first page, and is logged', async () => {
            const exact = full('Opt (M21-59)');
            const { client } = fakeCarton((l) => {
                if (l.expansion) throw new HttpError(500);
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
            const { client } = fakeCarton((l) => {
                if (!l.expansion) return page([full('Opt (M21-59)')]);
                controller.abort(err);
                throw err;
            });
            await expect(
                searcher(client).search('Opt', controller.signal)
            ).rejects.toBe(err);
        });
    });
});
