// Every searcher, on saved pages served by a fake client: which URLs it asks for, and what it does with the
// answers (follow-up pages for MTGin and Mana Vault, fallbacks when they fail).
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { parseGin } from '@/server/parsers/gin';
import { HttpError, ShopClient } from '@/server/shop-client';
import { CartonCardSearcher } from '@/server/searchers/carton-card-searcher';
import { GinCardSearcher } from '@/server/searchers/gin-card-searcher';
import { KartotekaCardSearcher } from '@/server/searchers/kartoteka-card-searcher';
import { ManavaultCardSearcher } from '@/server/searchers/manavault-card-searcher';
import { NerdikCardSearcher } from '@/server/searchers/nerdik-card-searcher';
import { PaytowinCardSearcher } from '@/server/searchers/paytowin-card-searcher';

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

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
    warn = spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('GinCardSearcher', () => {
    const base = 'https://mtgin.kyiv.ua';
    const searchUrl = `${base}/?q=Counterspell`;

    // the search page's summary tile, which links to the printings page
    async function searchPageAndSummary() {
        const page = await fixture('gin-search.html');
        const summary = parseGin(page, base).find((r) => r.printings);
        expect(summary).toBeDefined();
        return { page, summary: summary! };
    }

    test('expands an exact summary tile into its printings', async () => {
        const { page, summary } = await searchPageAndSummary();
        const { client, requested } = fakeClient(base, {
            [searchUrl]: page,
            [summary.url]: await fixture('gin-printings.html')
        });

        const results = await new GinCardSearcher(client).search(
            'Counterspell'
        );
        expect(requested()).toEqual([searchUrl, summary.url]);
        expect(results.length).toBeGreaterThan(1);
        expect(results.some((r) => r.printings)).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });

    test('keeps the summary tile, and logs, when the printings page fails', async () => {
        const { page, summary } = await searchPageAndSummary();
        const { client } = fakeClient(base, {
            [searchUrl]: page,
            [summary.url]: new HttpError(429)
        });

        const results = await new GinCardSearcher(client).search(
            'Counterspell'
        );
        expect(results).toEqual([summary]);
        expect(warn).toHaveBeenCalledTimes(1);
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
        expect(warn).not.toHaveBeenCalled();
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
        expect(warn).toHaveBeenCalled();
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
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
