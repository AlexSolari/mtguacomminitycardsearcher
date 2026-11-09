import { describe, expect, test } from 'bun:test';
import type { CardResult, SearchResult } from '@/search-result';
import type { ShopId } from '@/shops';
import type { CardSearcher } from '@/server/card-searcher';
import { CardSearchService } from '@/server/card-search-service';
import { HttpError } from '@/server/shop-client';
import { captureLogs } from './capture-logs';

const listing = (shop: ShopId, name: string): CardResult => ({
    shop,
    name,
    url: `https://example.com/${encodeURIComponent(name)}`,
    image: null,
    price: 10
});
const searcher = (
    shop: ShopId,
    search: CardSearcher['search']
): CardSearcher => ({ shop, search });

const logs = captureLogs();

describe('CardSearchService', () => {
    test('keeps only listings whose name contains the query', async () => {
        const service = new CardSearchService([
            searcher('carton', async () => [
                listing('carton', 'Sol Ring (C21-263)'),
                listing('carton', 'Soldier of the Grey Host')
            ]),
            searcher('gin', async () => [
                listing('gin', 'Sol Ring — Fallout #359')
            ])
        ]);
        const result = await service.search('sol ring');
        expect(result.card).toBe('sol ring');
        expect(result.links.map((l) => l.name)).toEqual([
            'Sol Ring (C21-263)',
            'Sol Ring — Fallout #359'
        ]);
        expect(result.errors).toEqual([]);
    });

    test('a failing shop is reported, the others still count', async () => {
        const service = new CardSearchService([
            searcher('carton', async () => [listing('carton', 'Sol Ring')]),
            searcher('nerdik', async () => {
                throw new HttpError(403);
            }),
            searcher('gin', async () => {
                throw new Error('timeout after 15s');
            })
        ]);
        const result = await service.search('Sol Ring');
        expect(result.links).toHaveLength(1);
        expect(result.errors).toEqual([
            { shop: 'nerdik', message: 'HTTP 403', status: 403 },
            { shop: 'gin', message: 'timeout after 15s', status: undefined }
        ]);
        expect(logs).toMatchObject([
            {
                level: 'error',
                message: 'shop search failed',
                shop: 'nerdik',
                card: 'Sol Ring',
                error: { name: 'Error', message: 'HTTP 403', status: 403 }
            },
            {
                level: 'error',
                message: 'shop search failed',
                shop: 'gin',
                card: 'Sol Ring',
                error: { message: 'timeout after 15s' }
            }
        ]);
    });

    test('a cancelled search rejects instead of reporting errors', async () => {
        const controller = new AbortController();
        const service = new CardSearchService([
            searcher('carton', (_card, signal) =>
                Promise.reject(signal!.reason)
            )
        ]);
        controller.abort();
        await expect(
            service.search('Sol Ring', controller.signal)
        ).rejects.toHaveProperty('name', 'AbortError');
        expect(logs).toEqual([]);
    });

    test('reports the result so far each time a shop finishes, while others are still searching', async () => {
        let finishSlow!: () => void;
        const slow = new Promise<void>((r) => (finishSlow = r));
        const service = new CardSearchService([
            searcher('kartoteka', async () => {
                await slow;
                return [listing('kartoteka', 'Sol Ring')];
            }),
            searcher('carton', async () => [listing('carton', 'Sol Ring')]),
            searcher('gin', async () => {
                throw new HttpError(429);
            })
        ]);
        const updates: SearchResult[] = [];
        const result = await service.search(
            'Sol Ring',
            undefined,
            (partial) => {
                updates.push(partial);
                if (updates.length === 2) finishSlow();
            }
        );
        expect(updates).toEqual([
            {
                card: 'Sol Ring',
                links: [listing('carton', 'Sol Ring')],
                errors: [],
                pending: ['kartoteka', 'gin']
            },
            {
                card: 'Sol Ring',
                links: [listing('carton', 'Sol Ring')],
                errors: [{ shop: 'gin', message: 'HTTP 429', status: 429 }],
                pending: ['kartoteka']
            }
        ]);
        // in searcher order, though Kartoteka finished last; no `pending` once complete
        expect(result).toEqual({
            card: 'Sol Ring',
            links: [
                listing('kartoteka', 'Sol Ring'),
                listing('carton', 'Sol Ring')
            ],
            errors: [{ shop: 'gin', message: 'HTTP 429', status: 429 }]
        });
    });

    test('a cancelled search reports no more updates', async () => {
        const controller = new AbortController();
        const updates: SearchResult[] = [];
        const service = new CardSearchService([
            searcher('carton', async () => {
                await Bun.sleep(0); // gin is waiting by now
                controller.abort();
                return [];
            }),
            searcher(
                'gin',
                (_card, signal) =>
                    new Promise((_, reject) =>
                        signal!.addEventListener('abort', () =>
                            reject(signal!.reason)
                        )
                    )
            )
        ]);
        await expect(
            service.search('Sol Ring', controller.signal, (p) =>
                updates.push(p)
            )
        ).rejects.toHaveProperty('name', 'AbortError');
        expect(updates).toEqual([]);
    });
});
