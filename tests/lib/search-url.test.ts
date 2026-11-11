import { describe, expect, test } from 'bun:test';
import { parseCardList } from '@/decklist';
import { cardListFromQuery, searchQuery } from '@/lib/search-url';

describe('searchQuery', () => {
    test('puts one q per card, with the count only above 1', () => {
        expect(
            searchQuery([
                { name: 'Fatal Push', count: 1 },
                { name: 'Consider', count: 2 },
                { name: 'Fire // Ice', count: 1 }
            ])
        ).toBe('?q=Fatal+Push&q=2+Consider&q=Fire+%2F%2F+Ice');
    });
});

describe('cardListFromQuery', () => {
    test('reads one line per q', () => {
        expect(cardListFromQuery('?q=Fatal+Push&q=2+Consider')).toBe(
            'Fatal Push\n2 Consider'
        );
    });

    test('reads valueless parameters as cards, for hand-typed links', () => {
        expect(cardListFromQuery('?q=Fatal%20Push&Consider&Opt')).toBe(
            'Fatal Push\nConsider\nOpt'
        );
    });

    test('ignores other parameters and blank cards', () => {
        expect(cardListFromQuery('?utm_source=tg&q=%20&q=Opt&q=')).toBe('Opt');
        expect(cardListFromQuery('')).toBe('');
    });

    test('round-trips through searchQuery and the card list parser', () => {
        const cards = [
            { name: 'Æther Vial', count: 4 },
            { name: 'Bonecrusher Giant // Stomp', count: 1 }
        ];
        expect(
            parseCardList(cardListFromQuery(searchQuery(cards))).cards
        ).toEqual(cards);
    });
});
