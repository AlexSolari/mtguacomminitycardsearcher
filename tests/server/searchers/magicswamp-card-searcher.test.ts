// Magic Swamp is a single-request searcher: it asks for the right URL, passes the caller's signal on,
// and parses the answer.
import { describe, expect, test } from 'bun:test';
import { MagicswampCardSearcher } from '@/server/searchers/magicswamp-card-searcher';
import { fakeClient, fixture } from './fake-client';
import { captureLogs } from '../capture-logs';

const logs = captureLogs();

describe('MagicswampCardSearcher', () => {
    test('asks for the listings and parses them', async () => {
        const url =
            'https://magicswamp.com.ua/api/listings/grouped/cards?game=mtg&search=Sol+Ring&limit=100';
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
        expect(logs).toEqual([]);
    });

    // the API allows 300 requests a minute for all our users together
    test('stays under 300 requests a minute', () => {
        const { client } = new MagicswampCardSearcher() as unknown as {
            client: { baseUrl: string; intervalMs: number };
        };
        expect(client.baseUrl).toBe('https://magicswamp.com.ua');
        expect(client.intervalMs).toBe(220);
    });

    test('logs an error when results span several pages', async () => {
        const url =
            'https://magicswamp.com.ua/api/listings/grouped/cards?game=mtg&search=Opt&limit=100';
        const page = JSON.parse(await fixture('magicswamp-search.json'));
        const { client } = fakeClient('https://magicswamp.com.ua', {
            [url]: JSON.stringify({ ...page, total: 150, totalPages: 2 })
        });
        const results = await new MagicswampCardSearcher(client).search('Opt');
        expect(results.length).toBeGreaterThan(0);
        expect(logs).toMatchObject([
            {
                level: 'error',
                message: 'magicswamp results span several pages',
                shop: 'magicswamp',
                card: 'Opt',
                total: 150,
                totalPages: 2
            }
        ]);
    });
});
