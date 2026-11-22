// CartonCardSearcher on saved pages served by a fake client: its next pages and full offer lists, and fallbacks
// when they fail.
import { describe, expect, test } from 'bun:test';
import {
    HttpError,
    ShopClient,
    ShopRequestError
} from '@/server/outbound/shop-client';
import {
    CartonCardSearcher,
    ALL_OFFERS,
    MAX_OFFER_PAGES,
    MAX_SEARCH_PAGES,
    OFFERS_PER_PRODUCT,
    PRODUCTS_PER_PAGE
} from '@/server/searchers/carton-card-searcher';
import { captureLogs } from '../capture-logs';

const logs = captureLogs();

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
