// PayToWin is a single-request searcher: it asks for the right URL, passes the caller's signal on,
// and parses the answer.
import { describe, expect, test } from 'bun:test';
import { PaytowinCardSearcher } from '@/server/searchers/paytowin-card-searcher';
import { fakeClient, fixture } from './fake-client';
import { captureLogs } from '../capture-logs';

captureLogs();

describe('PaytowinCardSearcher', () => {
    test('asks for the auctions and parses them', async () => {
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
});
