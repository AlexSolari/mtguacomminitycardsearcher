// Kartoteka is a single-request searcher: it asks for the right URL, passes the caller's signal on,
// and parses the answer.
import { describe, expect, test } from 'bun:test';
import { KartotekaCardSearcher } from '@/server/shops/kartoteka/kartoteka-card-searcher';
import { fakeClient, fixture } from '../fake-client';
import { captureLogs } from '../../capture-logs';

captureLogs();

describe('KartotekaCardSearcher', () => {
    test('asks for the search page and parses it', async () => {
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
});
