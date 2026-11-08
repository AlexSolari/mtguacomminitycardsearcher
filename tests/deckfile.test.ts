import { describe, expect, test } from 'bun:test';
import { DeckFileError, deckFileToCards, deckTextToCards } from '@/deckfile';

describe('deckTextToCards', () => {
    test('MTGO .dek: main and sideboard add up, XML entities decoded', () => {
        const dek = [
            '<?xml version="1.0" encoding="utf-8"?>',
            '<Deck>',
            '  <Cards CatID="1" Quantity="4" Sideboard="false" Name="Lightning Bolt" />',
            '  <Cards CatID="1" Quantity="2" Sideboard="true" Name="Lightning Bolt" />',
            '  <Cards CatID="2" Quantity="1" Sideboard="false" Name="Minsc &amp; Boo, Timeless Heroes" />',
            '</Deck>'
        ].join('\n');
        expect(deckTextToCards(dek)).toEqual([
            { name: 'Lightning Bolt', count: 6 },
            { name: 'Minsc & Boo, Timeless Heroes', count: 1 }
        ]);
    });

    test('CSV (Moxfield): Name and Count columns, quoted commas', () => {
        const csv = [
            '"Count","Tradelist Count","Name","Edition"',
            '"4","0","Lightning Bolt","m10"',
            '"1","0","Kenrith, the Returned King","eld"'
        ].join('\n');
        expect(deckTextToCards(csv, 'deck.csv')).toEqual([
            { name: 'Lightning Bolt', count: 4 },
            { name: 'Kenrith, the Returned King', count: 1 }
        ]);
    });

    test('CSV without a count column counts rows', () => {
        expect(
            deckTextToCards('Card Name,Set\nSol Ring,C21\nSol Ring,CMR')
        ).toEqual([{ name: 'Sol Ring', count: 2 }]);
    });

    test('a .csv with no name column falls back to the text parser', () => {
        expect(deckTextToCards('4 Lightning Bolt', 'deck.csv')).toEqual([
            { name: 'Lightning Bolt', count: 4 }
        ]);
    });

    test('plain text export', () => {
        expect(
            deckTextToCards('Deck\n4 Lightning Bolt\n1 Sol Ring (C21) 263')
        ).toEqual([
            { name: 'Lightning Bolt', count: 4 },
            { name: 'Sol Ring', count: 1 }
        ]);
    });
});

describe('deckFileToCards', () => {
    test('reads a file', async () => {
        const file = new File(['4 Lightning Bolt'], 'deck.txt');
        expect(await deckFileToCards(file)).toEqual([
            { name: 'Lightning Bolt', count: 4 }
        ]);
    });

    test('rejects files over 1 MB', async () => {
        const file = new File(['x'.repeat(1_000_001)], 'big.txt');
        await expect(deckFileToCards(file)).rejects.toBeInstanceOf(
            DeckFileError
        );
    });

    test('rejects binary files', async () => {
        const file = new File(['PK\u0000\u0003'], 'deck.zip');
        await expect(deckFileToCards(file)).rejects.toBeInstanceOf(
            DeckFileError
        );
    });
});
