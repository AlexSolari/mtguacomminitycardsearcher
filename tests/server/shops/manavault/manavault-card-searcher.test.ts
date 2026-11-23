// ManavaultCardSearcher on answers served by a fake client: its batches, the API's request budget, and names
// the API rejects or doesn't answer.
import { describe, expect, test } from 'bun:test';
import { HttpError, ShopClient } from '@/server/outbound/shop-client';
import { parseManavault } from '@/server/shops/manavault/manavault-parser';
import {
    ManavaultCardSearcher,
    manavaultSource
} from '@/server/shops/manavault/manavault-card-searcher';
import type { WindowBudget } from '@/server/outbound/window-budget';
import { fixture } from '../fake-client';
import { captureLogs } from '../../capture-logs';

const logs = captureLogs();

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
