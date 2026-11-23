// Shared by the searcher tests: saved shop pages (tests/fixtures/) served by a fake client.
import { ShopClient } from '@/server/outbound/shop-client';

export const fixture = (name: string) =>
    Bun.file(new URL(`../../fixtures/${name}`, import.meta.url)).text();

// A ShopClient that answers from `pages` (URL → body, or an error to throw) and fails on any other URL.
// `requests` records each URL with the options it was fetched with.
export function fakeClient(
    baseUrl: string,
    pages: Record<string, string | Error>
) {
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
