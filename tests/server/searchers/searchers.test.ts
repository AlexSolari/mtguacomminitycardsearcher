// Every searcher, on saved pages served by a fake client: which URLs it asks for, and what it does with the
// answers (MTGin's batching, Mana Vault's follow-up page, fallbacks when they fail).
import { describe, expect, test } from 'bun:test';
import { HttpError, ShopClient } from '@/server/shop-client';
import { CartonCardSearcher } from '@/server/searchers/carton-card-searcher';
import { CitadelCardSearcher } from '@/server/searchers/citadel-card-searcher';
import { GinCardSearcher } from '@/server/searchers/gin-card-searcher';
import { KartotekaCardSearcher } from '@/server/searchers/kartoteka-card-searcher';
import { MagicswampCardSearcher } from '@/server/searchers/magicswamp-card-searcher';
import { ManavaultCardSearcher } from '@/server/searchers/manavault-card-searcher';
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

describe('ManavaultCardSearcher', () => {
    const base = 'https://manavaultstore.com';
    const searchUrl = `${base}/cards?q=Counterspell`;
    const versionsUrl = `${base}/cards/versions?name=Counterspell`;

    test('swaps the exact tile for its versions page', async () => {
        const { client, requested } = fakeClient(base, {
            [searchUrl]: await fixture('manavault-search.html'),
            [versionsUrl]: await fixture('manavault-versions.html')
        });
        const results = await new ManavaultCardSearcher(client).search(
            'Counterspell'
        );
        expect(requested()).toEqual([searchUrl, versionsUrl]);
        expect(results.length).toBeGreaterThan(1);
        expect(results.every((r) => r.url !== versionsUrl)).toBe(true);
    });

    test('keeps fuzzy "other matches" next to the expanded printings', async () => {
        // a search page with the exact tile and a fuzzy one
        const tile = (id: string, name: string) =>
            `<a class="group flex flex-col" href="/cards/${id}"><img src="/img/${id}.webp"><h3>${name}</h3><span>від 100 ₴</span></a>`;
        const { client } = fakeClient(base, {
            [searchUrl]:
                tile('exact', 'Counterspell') +
                tile('fuzzy', 'Counterspell Squad'),
            [versionsUrl]: await fixture('manavault-versions.html')
        });
        const results = await new ManavaultCardSearcher(client).search(
            'Counterspell'
        );
        expect(results.some((r) => r.name === 'Counterspell Squad')).toBe(true);
        expect(results.some((r) => r.url === `${base}/cards/exact`)).toBe(
            false
        ); // replaced by its printings
        expect(results.length).toBeGreaterThan(2);
    });

    test('a 404 on the versions page keeps the search tile, quietly', async () => {
        const { client } = fakeClient(base, {
            [searchUrl]: await fixture('manavault-search.html'),
            [versionsUrl]: new HttpError(404)
        });
        const results = await new ManavaultCardSearcher(client).search(
            'Counterspell'
        );
        expect(results.map((r) => r.url)).toEqual([versionsUrl]); // the tile links to the versions page
        expect(logs).toEqual([]);
    });

    test('other failures keep the search tile and are logged', async () => {
        const { client } = fakeClient(base, {
            [searchUrl]: await fixture('manavault-search.html'),
            [versionsUrl]: new Error('timeout after 15s')
        });
        const results = await new ManavaultCardSearcher(client).search(
            'Counterspell'
        );
        expect(results).toHaveLength(1);
        expect(logs).not.toEqual([]);
    });

    test('an aborted search rejects instead of falling back', async () => {
        const controller = new AbortController();
        const abortError = new DOMException('aborted', 'AbortError');
        const { client } = fakeClient(base, {
            [searchUrl]: await fixture('manavault-search.html'),
            [versionsUrl]: abortError
        });
        controller.abort(abortError);
        await expect(
            new ManavaultCardSearcher(client).search(
                'Counterspell',
                controller.signal
            )
        ).rejects.toBe(abortError);
    });
});

// The single-request searchers: they ask for the right URL, pass the caller's signal on, and parse the answer.
describe('single-request searchers', () => {
    test('CartonCardSearcher', async () => {
        const url = 'https://carton.cards/search?q=Counterspell';
        const { client, requests } = fakeClient('https://carton.cards', {
            [url]: await fixture('carton-search.html')
        });
        const signal = new AbortController().signal;
        const results = await new CartonCardSearcher(client).search(
            'Counterspell',
            signal
        );
        expect(results.length).toBeGreaterThan(0);
        expect(requests).toEqual([{ url, init: { signal } }]);
    });

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

    test('NerdikCardSearcher sends its API key', async () => {
        const url =
            'https://hub.nerdik.club/api/singles/search?q=Counterspell&limit=60';
        const { client, requests } = fakeClient('https://hub.nerdik.club', {
            [url]: await fixture('nerdik-search.json')
        });
        const results = await new NerdikCardSearcher(client, 'test-key').search(
            'Counterspell'
        );
        expect(results.length).toBeGreaterThan(0);
        expect(requests).toHaveLength(1);
        expect(requests[0]!.url).toBe(url);
        expect(requests[0]!.init?.headers).toEqual({ 'X-API-Key': 'test-key' });
    });

    test('NerdikCardSearcher without a key fails without a request', async () => {
        const { client, requests } = fakeClient('https://hub.nerdik.club', {});
        await expect(
            new NerdikCardSearcher(client, '').search('Counterspell')
        ).rejects.toThrow('NERDIK_API_KEY is not set');
        expect(requests).toHaveLength(0);
    });

    test('an empty parse is logged (how a shop redesign shows up)', async () => {
        const url = 'https://carton.cards/search?q=Counterspell';
        const { client } = fakeClient('https://carton.cards', {
            [url]: '<html></html>'
        });
        expect(
            await new CartonCardSearcher(client).search('Counterspell')
        ).toEqual([]);
        expect(logs).toHaveLength(1);
    });
});
