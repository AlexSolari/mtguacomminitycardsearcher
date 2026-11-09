// Every searcher, on saved pages served by a fake client: which URLs it asks for, and what it does with the
// answers (MTGin's batching, CartOn's follow-up pages, fallbacks when they fail).
import { describe, expect, test } from 'bun:test';
import { HttpError, ShopClient } from '@/server/shop-client';
import { parseCarton } from '@/server/parsers/scrapers/carton';
import { parseManavault } from '@/server/parsers/api/manavault';
import { CartonCardSearcher } from '@/server/searchers/carton-card-searcher';
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
    const waitForBatch = () => Bun.sleep(40);

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

// The cap and the fallbacks for failed product pages are expandCheapest's, tested in card-searcher.test.ts.
describe('CartonCardSearcher', () => {
    const base = 'https://carton.cards';
    const searchUrl = `${base}/search?q=Counterspell`;

    test("swaps each exact product for its page's offers", async () => {
        const productPage = await fixture('carton-product.html');
        const searchHtml = await fixture('carton-search.html');
        // every product in the saved search is a Counterspell printing
        const products = parseCarton(searchHtml, base).map((r) => r.url);
        expect(products.length).toBeGreaterThan(0);
        const { client, requests } = fakeClient(base, {
            [searchUrl]: searchHtml,
            ...Object.fromEntries(products.map((u) => [u, productPage]))
        });
        const signal = new AbortController().signal;
        const results = await new CartonCardSearcher(client).search(
            'Counterspell',
            signal
        );
        expect(requests[0]).toEqual({ url: searchUrl, init: { signal } });
        expect(
            requests
                .map((r) => r.url)
                .slice(1)
                .sort()
        ).toEqual(products.sort());
        expect(requests.every((r) => r.init?.signal === signal)).toBe(true);
        // offers, not tiles: they know their stock
        expect(results.length).toBeGreaterThan(0);
        expect(results.every((r) => r.stock! > 0 && !r.fromPrice)).toBe(true);
        expect(logs).toEqual([]);
    });

    test('keeps fuzzy matches as tiles', async () => {
        const fuzzy = `${base}/magic-the-gathering/singles/squad`;
        const { client, requested } = fakeClient(base, {
            [searchUrl]: `<div id="app" data-page="${JSON.stringify({
                props: {
                    products: [
                        {
                            name: 'Counterspell Squad (SET-1)',
                            url_path: new URL(fuzzy).pathname,
                            min_price: 1
                        }
                    ]
                }
            }).replace(/"/g, '&quot;')}"></div>`
        });
        const results = await new CartonCardSearcher(client).search(
            'Counterspell'
        );
        expect(requested()).toEqual([searchUrl]);
        expect(results).toMatchObject([{ url: fuzzy, fromPrice: true }]);
    });

    test('an empty search parse is logged (how a shop redesign shows up)', async () => {
        const { client } = fakeClient(base, { [searchUrl]: '<html></html>' });
        expect(
            await new CartonCardSearcher(client).search('Counterspell')
        ).toEqual([]);
        expect(logs).toHaveLength(1);
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
            'https://magicswamp.com.ua/api/listings/grouped/cards?game=mtg&search=Sol+Ring&limit=50';
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

    test('ManavaultCardSearcher names its source', async () => {
        const url =
            'https://manavaultstore.com/api/v1/prices?q=Counterspell&source=example.up.railway.app';
        const body = await fixture('manavault-search.json');
        const { client, requests } = fakeClient('https://manavaultstore.com', {
            [url]: body
        });
        const signal = new AbortController().signal;
        const results = await new ManavaultCardSearcher(
            client,
            'example.up.railway.app'
        ).search('Counterspell', signal);
        expect(results).toEqual(parseManavault(JSON.parse(body)));
        expect(results.length).toBeGreaterThan(0);
        expect(requests).toEqual([{ url, init: { signal } }]);
    });

    test("Mana Vault's source is Railway's public domain, else a fixed name", () => {
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

    // the API allows 60 requests a minute for all our users together
    test('ManavaultCardSearcher sends at most one request a second', () => {
        const { client } = new ManavaultCardSearcher() as unknown as {
            client: { baseUrl: string; intervalMs: number };
        };
        expect(client.baseUrl).toBe('https://manavaultstore.com');
        expect(client.intervalMs).toBe(1000);
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
                { cards: [] },
                JSON.parse(
                    // a result per name, in request order; the API sent one fewer than asked
                    '{"cards":[{"name":"Daze","game":"mtg","set_name":"Nemesis","number":"31","language":"en","treatment":"regular","image_url":null,"nerdik_url":"https://nerdik.club/mtg/singles/nem/31/en/","offers":[{"price_uah":"90.00","available_quantity":2,"nerdik_url":null}]}]}'
                )
            ]
        }));
        const nerdik = new NerdikCardSearcher(client, 'test-key');
        const [bolt, daze, missing] = await Promise.all([
            nerdik.search('Lightning Bolt'),
            nerdik.search('Daze'),
            nerdik.search('Force of Will')
        ]);
        expect(requests).toHaveLength(1);
        expect(requests[0]!.body.cards.map((c) => c.name)).toEqual([
            'Lightning Bolt',
            'Daze',
            'Force of Will'
        ]);
        expect(bolt).toEqual([]);
        expect(daze!.map((r) => [r.name, r.price])).toEqual([
            ['Daze — Nemesis #31', 90]
        ]);
        expect(missing).toEqual([]);
    });

    test('without a key it fails without a request', async () => {
        const { client, requests } = fakeNerdik();
        await expect(
            new NerdikCardSearcher(client, '').search('Counterspell')
        ).rejects.toThrow('NERDIK_API_KEY is not set');
        expect(requests).toHaveLength(0);
    });
});
