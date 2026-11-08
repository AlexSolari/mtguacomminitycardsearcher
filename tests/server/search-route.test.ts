import { describe, expect, test } from 'bun:test';
import type { SearchResult } from '@/search-result';
import { InFlightLimiter } from '@/server/in-flight-limiter';
import {
    clientId,
    MAX_CARDS_PER_REQUEST,
    searchHandler
} from '@/server/search-route';
import { captureLogs } from './capture-logs';

const result = (card: string): SearchResult => ({
    card,
    links: [],
    errors: []
});

// A card search that answers at once, recording what it was asked for.
function fakeSearch() {
    const searched: string[] = [];
    return {
        searched,
        search: async (card: string) => {
            searched.push(card);
            return result(card);
        }
    };
}

const post = (body: unknown, init: RequestInit = {}) =>
    new Request('http://localhost/api/search', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        ...init
    });

const logs = captureLogs();

describe('searchHandler', () => {
    test('searches each card and returns the results in list order', async () => {
        const cardSearch = fakeSearch();
        const handle = searchHandler(cardSearch, new InFlightLimiter(12));
        const res = await handle(post({ cards: ['Sol Ring', 'Daze'] }), 'a');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            results: [result('Sol Ring'), result('Daze')]
        });
        expect(cardSearch.searched).toEqual(['Sol Ring', 'Daze']);
    });

    test('drops non-strings and names with nothing searchable, and trims the rest', async () => {
        const cardSearch = fakeSearch();
        const handle = searchHandler(cardSearch, new InFlightLimiter(12));
        await handle(
            post({ cards: ['  Sol Ring ', 42, null, '!!!', '   ', 'Daze'] }),
            'a'
        );
        expect(cardSearch.searched).toEqual(['Sol Ring', 'Daze']);
    });

    test('a malformed body searches nothing', async () => {
        const handle = searchHandler(fakeSearch(), new InFlightLimiter(12));
        for (const body of ['not json', { cards: 'Sol Ring' }, {}]) {
            const res = await handle(post(body), 'a');
            expect(await res.json()).toEqual({ results: [] });
        }
    });

    test('logs the first few names and the count', async () => {
        const handle = searchHandler(fakeSearch(), new InFlightLimiter(12));
        const cards = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
        await handle(post({ cards }), 'a');
        expect(logs).toMatchObject([
            {
                level: 'info',
                message: 'search',
                cards: ['A', 'B', 'C', 'D', 'E'],
                count: 7
            }
        ]);
    });

    test('too many cards is a 400, and nothing is searched', async () => {
        const cardSearch = fakeSearch();
        const handle = searchHandler(cardSearch, new InFlightLimiter(12));
        const cards = Array.from(
            { length: MAX_CARDS_PER_REQUEST + 1 },
            (_, i) => `Card ${i}`
        );
        const res = await handle(post({ cards }), 'a');
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
            error: `Too many cards (max ${MAX_CARDS_PER_REQUEST})`
        });
        expect(cardSearch.searched).toEqual([]);
    });

    test("a client's cards go through the limiter", async () => {
        let active = 0;
        let peak = 0;
        const handle = searchHandler(
            {
                search: async (card) => {
                    peak = Math.max(peak, ++active);
                    await Bun.sleep(5);
                    active--;
                    return result(card);
                }
            },
            new InFlightLimiter(2)
        );
        await handle(post({ cards: ['A', 'B', 'C', 'D', 'E'] }), 'a');
        expect(peak).toBe(2);
    });

    test('a client that disconnects gets a 499, and the search sees the abort', async () => {
        const controller = new AbortController();
        let seen: AbortSignal | undefined;
        const handle = searchHandler(
            {
                search: (_card, signal) => {
                    seen = signal;
                    return new Promise((_, reject) =>
                        signal!.addEventListener('abort', () =>
                            reject(signal!.reason)
                        )
                    );
                }
            },
            new InFlightLimiter(12)
        );
        const pending = handle(
            post({ cards: ['Sol Ring'] }, { signal: controller.signal }),
            'a'
        );
        await Bun.sleep(0);
        controller.abort();
        const res = await pending;
        expect(res.status).toBe(499);
        expect(seen?.aborted).toBe(true);
    });

    test('any other failure is rethrown', async () => {
        const handle = searchHandler(
            {
                search: async () => {
                    throw new Error('boom');
                }
            },
            new InFlightLimiter(12)
        );
        await expect(
            handle(post({ cards: ['Sol Ring'] }), 'a')
        ).rejects.toThrow('boom');
    });
});

describe('clientId', () => {
    const req = (forwarded?: string) =>
        new Request('http://localhost/', {
            headers: forwarded ? { 'x-forwarded-for': forwarded } : {}
        });

    test('trusts only the last X-Forwarded-For entry, the one the proxy added', () => {
        expect(clientId(req('6.6.6.6, 10.0.0.1 , 1.2.3.4 '), '9.9.9.9')).toBe(
            '1.2.3.4'
        );
    });

    test('without the header, the connection address', () => {
        expect(clientId(req(), '9.9.9.9')).toBe('9.9.9.9');
        expect(clientId(req(''), '9.9.9.9')).toBe('9.9.9.9');
    });

    test('with neither, a shared fallback', () => {
        expect(clientId(req(), undefined)).toBe('unknown');
    });
});
