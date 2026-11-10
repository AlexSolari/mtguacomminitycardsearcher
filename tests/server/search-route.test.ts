import { describe, expect, test } from 'bun:test';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { SearchResult, SearchUpdate } from '@/search-result';
import { InFlightLimiter } from '@/server/in-flight-limiter';
import {
    clientId,
    MAX_CARDS_PER_REQUEST,
    MAX_NAME_LENGTH,
    searchHandler
} from '@/server/search-route';
import { withSpan } from '@/server/tracing';
import { VisitorIds } from '@/server/visitor-id';
import { captureLogs } from './capture-logs';
import { captureSpans, idOf, parentOf } from './capture-spans';

const result = (card: string): SearchResult => ({
    card,
    links: [],
    errors: []
});

// A card search that answers at once, recording what it was asked for.
function fakeSearch() {
    const searched: string[] = [];
    const fullNames: (string | undefined)[] = [];
    return {
        searched,
        fullNames,
        search: async (
            card: string,
            _signal?: AbortSignal,
            _onUpdate?: unknown,
            fullName?: string
        ) => {
            searched.push(card);
            fullNames.push(fullName);
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

// The streamed lines, parsed.
async function updates(res: Response): Promise<SearchUpdate[]> {
    const text = await res.text();
    return text
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l));
}

// The last line for each card, in list order.
async function finalResults(res: Response) {
    const last = new Map<number, SearchResult>();
    for (const u of await updates(res)) last.set(u.index, u.result);
    return [...last].sort(([a], [b]) => a - b).map(([, r]) => r);
}

const logs = captureLogs();
const spans = captureSpans();
const requestSpans = () => spans().filter((s) => s.name === 'POST /api/search');

describe('searchHandler', () => {
    test('searches each card and streams the results', async () => {
        const cardSearch = fakeSearch();
        const handle = searchHandler(cardSearch, new InFlightLimiter(12));
        const res = await handle(post({ cards: ['Sol Ring', 'Daze'] }), 'a');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toStartWith(
            'application/x-ndjson'
        );
        expect(await finalResults(res)).toEqual([
            result('Sol Ring'),
            result('Daze')
        ]);
        expect(cardSearch.searched).toEqual(['Sol Ring', 'Daze']);
    });

    test('drops non-strings and names with nothing searchable, and trims the rest', async () => {
        const cardSearch = fakeSearch();
        const handle = searchHandler(cardSearch, new InFlightLimiter(12));
        const res = await handle(
            post({ cards: ['  Sol Ring ', 42, null, '!!!', '   ', 'Daze'] }),
            'a'
        );
        await res.text();
        expect(cardSearch.searched).toEqual(['Sol Ring', 'Daze']);
    });

    test('drops names no card could have: too long, or with injection characters', async () => {
        const cardSearch = fakeSearch();
        const handle = searchHandler(cardSearch, new InFlightLimiter(12));
        const longest = 'x'.repeat(MAX_NAME_LENGTH);
        const res = await handle(
            post({
                cards: [
                    '{"username": {"$ne": null}}',
                    '<machineKey validationKey="[String]" />',
                    'x'.repeat(MAX_NAME_LENGTH + 1),
                    longest,
                    'Kongming, "Sleeping Dragon"',
                    'Who/What/When/Where/Why'
                ]
            }),
            'a'
        );
        await res.text();
        expect(cardSearch.searched).toEqual([
            longest,
            'Kongming, "Sleeping Dragon"',
            'Who/What/When/Where/Why'
        ]);
    });

    test('a malformed body searches nothing', async () => {
        const handle = searchHandler(fakeSearch(), new InFlightLimiter(12));
        for (const body of ['not json', { cards: 'Sol Ring' }, {}]) {
            const res = await handle(post(body), 'a');
            expect(await res.text()).toBe('');
        }
    });

    test('logs the first few names and the count', async () => {
        const handle = searchHandler(fakeSearch(), new InFlightLimiter(12));
        const cards = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
        await (await handle(post({ cards }), 'a')).text();
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
        const res = await handle(
            post({ cards: ['A', 'B', 'C', 'D', 'E'] }),
            'a'
        );
        await res.text();
        expect(peak).toBe(2);
    });

    test('streams each partial result before the complete one', async () => {
        const handle = searchHandler(
            {
                search: async (card, _signal, onUpdate) => {
                    onUpdate?.({ ...result(card), pending: ['kartoteka'] });
                    await Bun.sleep(5);
                    return result(card);
                }
            },
            new InFlightLimiter(12)
        );
        const res = await handle(post({ cards: ['Sol Ring'] }), 'a');
        expect(await updates(res)).toEqual([
            {
                index: 0,
                result: { ...result('Sol Ring'), pending: ['kartoteka'] }
            },
            { index: 0, result: result('Sol Ring') }
        ]);
    });

    test('a slow card does not hold back a fast one', async () => {
        const handle = searchHandler(
            {
                search: async (card) => {
                    if (card === 'Slow') await Bun.sleep(20);
                    return result(card);
                }
            },
            new InFlightLimiter(12)
        );
        const res = await handle(post({ cards: ['Slow', 'Fast'] }), 'a');
        expect(await updates(res)).toEqual([
            { index: 1, result: result('Fast') },
            { index: 0, result: result('Slow') }
        ]);
    });

    test('a client that disconnects ends the stream, and the search sees the abort', async () => {
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
        const res = await handle(
            post({ cards: ['Sol Ring'] }, { signal: controller.signal }),
            'a'
        );
        await Bun.sleep(0);
        controller.abort();
        expect(await res.text()).toBe('');
        expect(seen?.aborted).toBe(true);
        expect(logs).not.toContainEqual(
            expect.objectContaining({ message: 'card search failed' })
        );
    });

    test('searches under the corrected name and keeps the typed one', async () => {
        const cardSearch = fakeSearch();
        const handle = searchHandler(cardSearch, new InFlightLimiter(12), {
            resolve: async (card) =>
                card === 'overlord balemurk'
                    ? {
                          name: 'Overlord of the Balemurk',
                          fullName: 'Overlord of the Balemurk'
                      }
                    : { name: card, fullName: card }
        });
        const res = await handle(
            post({ cards: ['overlord balemurk', 'Daze'] }),
            'a'
        );
        expect(await finalResults(res)).toEqual([
            {
                ...result('Overlord of the Balemurk'),
                typed: 'overlord balemurk'
            },
            result('Daze')
        ]);
        expect(cardSearch.searched).toEqual([
            'Overlord of the Balemurk',
            'Daze'
        ]);
        expect(logs).toContainEqual(
            expect.objectContaining({
                message: 'name corrected',
                typed: 'overlord balemurk',
                card: 'Overlord of the Balemurk'
            })
        );
    });

    test("passes the card's full name along for the shops that need it", async () => {
        const cardSearch = fakeSearch();
        const handle = searchHandler(cardSearch, new InFlightLimiter(12), {
            resolve: async () => ({
                name: 'Bonecrusher Giant',
                fullName: 'Bonecrusher Giant // Stomp'
            })
        });
        await (await handle(post({ cards: ['bonecrusher'] }), 'a')).text();
        expect(cardSearch.searched).toEqual(['Bonecrusher Giant']);
        expect(cardSearch.fullNames).toEqual(['Bonecrusher Giant // Stomp']);
    });

    test('without a resolver, the full name is the name as sent', async () => {
        const cardSearch = fakeSearch();
        const handle = searchHandler(cardSearch, new InFlightLimiter(12));
        await (await handle(post({ cards: ['Daze'] }), 'a')).text();
        expect(cardSearch.fullNames).toEqual(['Daze']);
    });

    test('partial results keep the typed name too', async () => {
        const handle = searchHandler(
            {
                search: async (card, _signal, onUpdate) => {
                    onUpdate?.({ ...result(card), pending: ['kartoteka'] });
                    return result(card);
                }
            },
            new InFlightLimiter(12),
            {
                resolve: async () => ({
                    name: 'Overlord of the Balemurk',
                    fullName: 'Overlord of the Balemurk'
                })
            }
        );
        const res = await handle(post({ cards: ['overlord balemurk'] }), 'a');
        const lines = await updates(res);
        expect(lines).toHaveLength(2);
        for (const { result } of lines)
            expect(result.typed).toBe('overlord balemurk');
    });

    test("any other failure becomes the card's error, and the other cards still stream", async () => {
        const handle = searchHandler(
            {
                search: async (card) => {
                    if (card === 'Sol Ring') throw new Error('boom');
                    return result(card);
                }
            },
            new InFlightLimiter(12)
        );
        const res = await handle(post({ cards: ['Sol Ring', 'Daze'] }), 'a');
        expect(await finalResults(res)).toEqual([
            { card: 'Sol Ring', links: [], errors: [{ message: 'boom' }] },
            result('Daze')
        ]);
        expect(logs).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: 'card search failed',
                card: 'Sol Ring',
                error: expect.objectContaining({ message: 'boom' })
            })
        );
    });
});

describe('searchHandler spans', () => {
    test('the request span lasts until the stream closes, and the search runs inside it', async () => {
        const handle = searchHandler(
            {
                // stands in for a shop request
                search: (card) =>
                    withSpan('GET shop', SpanKind.CLIENT, {}, async () => {
                        await Bun.sleep(10);
                        return result(card);
                    })
            },
            new InFlightLimiter(12)
        );
        const res = await handle(post({ cards: ['Sol Ring'] }), 'a');
        // the Response is back, but the search is still running
        expect(requestSpans()).toHaveLength(0);
        await res.text();
        const [request] = requestSpans();
        expect(request).toMatchObject({
            kind: SpanKind.SERVER,
            attributes: {
                'http.request.method': 'POST',
                'url.path': '/api/search',
                'http.response.status_code': 200,
                'search.card_count': 1
            },
            status: { code: SpanStatusCode.UNSET }
        });
        const shop = spans().find((s) => s.name === 'GET shop')!;
        expect(parentOf(shop)).toBe(idOf(request!));
    });

    test("the span carries the visitor's daily id", async () => {
        const visitors = new VisitorIds(undefined, () => 'salt');
        const handle = searchHandler(
            fakeSearch(),
            new InFlightLimiter(12),
            undefined,
            visitors
        );
        const req = post({ cards: ['Sol Ring'] });
        req.headers.set('user-agent', 'Firefox');
        await (await handle(req, '1.2.3.4')).text();
        expect(requestSpans()[0]!.attributes['visitor.id']).toBe(
            new VisitorIds(undefined, () => 'salt').id('1.2.3.4', 'Firefox')
        );
    });

    test('too many cards ends the span with a 400', async () => {
        const handle = searchHandler(fakeSearch(), new InFlightLimiter(12));
        const cards = Array.from(
            { length: MAX_CARDS_PER_REQUEST + 1 },
            (_, i) => `Card ${i}`
        );
        await handle(post({ cards }), 'a');
        expect(requestSpans()).toMatchObject([
            { attributes: { 'http.response.status_code': 400 } }
        ]);
    });

    test("a card's failure is an event on the span, and marks it as an error", async () => {
        const handle = searchHandler(
            {
                search: async (card) => {
                    if (card === 'Sol Ring') throw new Error('boom');
                    return result(card);
                }
            },
            new InFlightLimiter(12)
        );
        await (await handle(post({ cards: ['Sol Ring', 'Daze'] }), 'a')).text();
        const [request] = requestSpans();
        expect(request!.status.code).toBe(SpanStatusCode.ERROR);
        expect(request!.events).toMatchObject([
            {
                name: 'card search failed',
                attributes: { card: 'Sol Ring', 'exception.message': 'boom' }
            }
        ]);
    });

    test('a client that disconnects ends the span with an `aborted` event, not an error', async () => {
        const controller = new AbortController();
        const handle = searchHandler(
            {
                search: (_card, signal) =>
                    new Promise((_, reject) =>
                        signal!.addEventListener('abort', () =>
                            reject(signal!.reason)
                        )
                    )
            },
            new InFlightLimiter(12)
        );
        const res = await handle(
            post({ cards: ['Sol Ring'] }, { signal: controller.signal }),
            'a'
        );
        await Bun.sleep(0);
        controller.abort();
        await res.text();
        const [request] = requestSpans();
        expect(request!.status.code).toBe(SpanStatusCode.UNSET);
        expect(request!.events.map((e) => e.name)).toEqual(['aborted']);
    });

    test('a handler that throws ends the span as an error', async () => {
        const handle = searchHandler(fakeSearch(), new InFlightLimiter(12));
        const req = post({ cards: ['Sol Ring'] });
        // a body that isn't JSON rejects, which is caught; json() throwing outright stands in for an unexpected failure
        Object.defineProperty(req, 'json', {
            value: () => {
                throw new Error('broken');
            }
        });
        await expect(handle(req, 'a')).rejects.toThrow('broken');
        expect(requestSpans()[0]!.status.code).toBe(SpanStatusCode.ERROR);
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
