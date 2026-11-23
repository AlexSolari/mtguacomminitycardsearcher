// Citadel is a single-request searcher: it asks for the right URL, passes the caller's signal on,
// and parses the answer.
import { describe, expect, test } from 'bun:test';
import { CitadelCardSearcher } from '@/server/shops/citadel/citadel-card-searcher';
import { fakeClient, fixture } from '../fake-client';
import { captureLogs } from '../../capture-logs';

captureLogs();

describe('CitadelCardSearcher', () => {
    test('asks for the search page and parses it', async () => {
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
});
