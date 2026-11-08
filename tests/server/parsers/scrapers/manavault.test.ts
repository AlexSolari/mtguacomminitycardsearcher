import { describe, expect, test } from 'bun:test';
import { isExactMatch } from '@/matching';
import { SHOP_INFO } from '@/shops';
import {
    parseManavault,
    parseManavaultVersions
} from '@/server/parsers/scrapers/manavault';
import { expectWellFormed, html } from '../parser-fixtures';

const base = SHOP_INFO.manavault.homepage;

describe('manavault', () => {
    test('search page: one tile per card', async () => {
        const results = parseManavault(
            await html('manavault-search.html'),
            base
        );
        expectWellFormed(results, 'manavault');
        // "126 – 2 719 ₴" across printings: the cheapest one counts
        expect(results[0]).toMatchObject({ price: 126, fromPrice: true });
        expect(results).toMatchSnapshot();
    });

    test('versions page: one offer per printing', async () => {
        const results = parseManavaultVersions(
            await html('manavault-versions.html'),
            base
        );
        expectWellFormed(results, 'manavault');
        expect(results.length).toBeGreaterThan(1);
        // the searcher keeps only exact matches from this page, so a lost card name drops every printing
        for (const r of results) {
            expect(isExactMatch(r.name, 'Counterspell')).toBe(true);
            expect(r.image).not.toBeNull();
        }
        expect(results).toMatchSnapshot();
    });

    // A page without the markup the parser expects is how a redesign shows up: it must give [] (logged by
    // warnIfEmpty), not throw and fail the whole shop.
    test('unexpected search page → []', () => {
        expect(parseManavault('<html></html>', base)).toEqual([]);
    });

    test('unexpected versions page → []', () => {
        expect(parseManavaultVersions('<html></html>', base)).toEqual([]);
    });
});
