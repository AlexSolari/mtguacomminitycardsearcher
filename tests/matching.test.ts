import { describe, expect, test } from 'bun:test';
import { isArtSeries, isExactMatch, normalize } from '@/matching';
import type { CardResult } from '@/search-result';

describe('normalize', () => {
    test.each([
        ['Jace, the Mind-Sculptor', 'jace the mind sculptor'],
        ['Æther Vial', 'aether vial'],
        ['æther vial', 'aether vial'],
        ["Lim-Dûl's Vault", 'lim dul s vault'],
        ['  Sol   Ring  ', 'sol ring'],
        ['!!!', '']
    ])('%p → %p', (input, expected) => {
        expect(normalize(input)).toBe(expected);
    });
});

describe('isExactMatch', () => {
    test.each([
        ['Daze', 'Daze'],
        ['Daze (PLST-DD2-23)', 'Daze'], // CartOn set suffix
        ['Counterspell (FDC-61)', 'counterspell'],
        ['Daze — Nemesis #29, Foil, English', 'daze'], // edition suffix
        ['Emeritus of Woe // Demonic Tutor', 'Demonic Tutor'], // either face
        ['Emeritus of Woe // Demonic Tutor', 'Emeritus of Woe'],
        [
            'Emeritus of Woe // Demonic Tutor',
            'Emeritus of Woe // Demonic Tutor'
        ],
        ['Aether Vial', 'Æther Vial'],
        ["Lim-Dûl's Vault", "Lim-Dul's Vault"]
    ])('%p is %p', (listing, query) => {
        expect(isExactMatch(listing, query)).toBe(true);
    });

    test.each([
        ['School Daze', 'Daze'],
        ['Sol Ring', 'Sol'],
        ['Soldier of the Grey Host', 'Sol Ring']
    ])('%p is not %p', (listing, query) => {
        expect(isExactMatch(listing, query)).toBe(false);
    });
});

describe('isArtSeries', () => {
    const card = (name: string, artSeries?: boolean): CardResult => ({
        shop: 'carton',
        name,
        url: 'https://example.com',
        image: null,
        price: 10,
        artSeries
    });

    test('trusts the parser flag', () => {
        expect(isArtSeries(card('Sol Ring', true))).toBe(true);
    });
    test('falls back to the name', () => {
        expect(isArtSeries(card('Sol Ring — Art Series'))).toBe(true);
        expect(isArtSeries(card('Sol Ring'))).toBe(false);
    });
});
