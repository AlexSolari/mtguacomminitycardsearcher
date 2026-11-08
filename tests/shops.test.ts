import { describe, expect, test } from 'bun:test';
import { manualSearchUrl } from '@/shops';

describe('manualSearchUrl', () => {
    test('a blocked (403) search links the shop’s own search page', () => {
        expect(
            manualSearchUrl(
                { shop: 'nerdik', message: 'HTTP 403', status: 403 },
                'Sol Ring'
            )
        ).toBe('https://nerdik.club/katalog/search/?q=Sol+Ring');
    });

    test.each([
        [
            'another failure',
            { shop: 'nerdik' as const, message: 'HTTP 500', status: 500 }
        ],
        [
            'a shop without a search page',
            { shop: 'carton' as const, message: 'HTTP 403', status: 403 }
        ],
        ['a failed request (no shop)', { message: 'HTTP 403', status: 403 }]
    ])('no link for %s', (_, error) => {
        expect(manualSearchUrl(error, 'Sol Ring')).toBeNull();
    });
});
