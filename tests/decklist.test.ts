import { describe, expect, test } from 'bun:test';
import { formatCardList, parseCardList } from '@/decklist';

describe('parseCardList', () => {
    test('plain names count once each', () => {
        expect(parseCardList('Lightning Bolt\nCounterspell').cards).toEqual([
            { name: 'Lightning Bolt', count: 1 },
            { name: 'Counterspell', count: 1 }
        ]);
    });

    test('quantities: "4", "4x", "4 x"', () => {
        expect(
            parseCardList('4 Lightning Bolt\n3x Counterspell\n2 x Daze').cards
        ).toEqual([
            { name: 'Lightning Bolt', count: 4 },
            { name: 'Counterspell', count: 3 },
            { name: 'Daze', count: 2 }
        ]);
    });

    test('repeats add up, ignoring case; the first spelling wins', () => {
        expect(parseCardList('2 Sol Ring\n1 sol ring').cards).toEqual([
            { name: 'Sol Ring', count: 3 }
        ]);
    });

    test('repeats match the way the server does: diacritics, æ and punctuation', () => {
        expect(
            parseCardList(
                '1 Æther Vial\n2 Aether Vial\n1 Lim-Dûl the Necromancer\n1 Lim-Dul the Necromancer'
            ).cards
        ).toEqual([
            { name: 'Æther Vial', count: 3 },
            { name: 'Lim-Dûl the Necromancer', count: 2 }
        ]);
    });

    test('names with nothing searchable are dropped', () => {
        expect(parseCardList('2 ???\n!!!\nSol Ring').cards).toEqual([
            { name: 'Sol Ring', count: 1 }
        ]);
    });

    test('Arena set codes, collector numbers and foil markers are stripped', () => {
        expect(
            parseCardList('1 Sol Ring (C21) 263\n1 Fire // Ice (MH3) 290 *F*')
                .cards
        ).toEqual([
            { name: 'Sol Ring', count: 1 },
            { name: 'Fire // Ice', count: 1 }
        ]);
    });

    test('skips section headers, comments and blank lines; strips "SB:"', () => {
        const text = [
            'Deck',
            '4 Lightning Bolt',
            '',
            '// a comment',
            '# another',
            'Sideboard',
            'SB: 2 Pyroblast',
            'Commander'
        ].join('\r\n');
        expect(parseCardList(text).cards).toEqual([
            { name: 'Lightning Bolt', count: 4 },
            { name: 'Pyroblast', count: 2 }
        ]);
    });

    test('links are returned separately', () => {
        const parsed = parseCardList(
            'https://www.mtggoldfish.com/deck/123\nSol Ring'
        );
        expect(parsed.links).toEqual(['https://www.mtggoldfish.com/deck/123']);
        expect(parsed.cards).toEqual([{ name: 'Sol Ring', count: 1 }]);
    });
});

test('formatCardList round-trips through parseCardList', () => {
    const cards = [
        { name: 'Lightning Bolt', count: 4 },
        { name: 'Fire // Ice', count: 1 }
    ];
    expect(formatCardList(cards)).toBe('4 Lightning Bolt\n1 Fire // Ice');
    expect(parseCardList(formatCardList(cards)).cards).toEqual(cards);
});
