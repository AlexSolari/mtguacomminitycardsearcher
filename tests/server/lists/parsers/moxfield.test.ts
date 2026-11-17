import { describe, expect, test } from 'bun:test';
import { parseMoxfield } from '@/server/lists/parsers/moxfield';
import { html } from '../../parsers/parser-fixtures';

const ID = 'cee0459b-9aac-4d2f-abe4-4d5fedde7eb8';
const IMAGE = `https://cards.scryfall.io/normal/front/c/e/${ID}.jpg`;
const row = {
    quantity: 1,
    finish: 'nonFoil',
    isFoil: false,
    card: {
        name: "Kroxa, Titan of Death's Hunger",
        set: 'THB',
        cn: '221',
        scryfall_id: ID,
        prices: { usd: 2.5000001, usd_foil: 3.25, eur: 2.97 }
    }
};
const deck = (boards: Record<string, unknown>, extra = {}) =>
    JSON.stringify({ mainboard: {}, ...boards, ...extra });

describe('moxfield', () => {
    test('deck: title, edit date and one row per printing, the maybeboard left out', async () => {
        const text = await html('moxfield-deck.json');
        const list = parseMoxfield(text);
        expect(list).not.toBeNull();
        expect(list!.title).toBeString();
        expect(list!.editedAt).toBeGreaterThan(0);
        expect(list!.cards.length).toBeGreaterThan(0);
        for (const card of list!.cards) {
            expect(card.name.trim()).not.toBe('');
            expect(card.quantity).toBeGreaterThan(0);
            expect(card.set).toMatch(/^[a-z0-9]{2,6}$/);
            expect(card.scryfallId).toMatch(/^[0-9a-f-]{36}$/);
            expect(card.image).toStartWith('https://cards.scryfall.io/');
            if (card.usd !== undefined) expect(card.usd).toBeGreaterThan(0);
        }
        expect(list!.cards.some((c) => c.finish === 'foil')).toBe(true);
        expect(list!.cards.some((c) => c.finish === 'nonfoil')).toBe(true);
        const maybe = Object.values(JSON.parse(text).maybeboard ?? {}).map(
            (r: any) => r.card.name
        );
        const main = new Set(
            Object.values(JSON.parse(text).mainboard).map(
                (r: any) => r.card.name
            )
        );
        for (const name of maybe.filter((n) => !main.has(n)))
            expect(list!.cards.map((c) => c.name)).not.toContain(name);
        expect(list).toMatchSnapshot();
    });

    test("reads a row: finish, printing, image from the Scryfall id, the finish's price to the cent", () => {
        expect(
            parseMoxfield(
                deck(
                    {
                        mainboard: { a: row },
                        sideboard: {
                            b: {
                                ...row,
                                quantity: 2,
                                finish: 'foil',
                                isFoil: true
                            }
                        },
                        commanders: {
                            c: {
                                ...row,
                                finish: 'etched',
                                card: { ...row.card, name: 'Fire // Ice' }
                            }
                        }
                    },
                    {
                        name: '  Sell list  ',
                        lastUpdatedAtUtc: '2026-09-14T22:39:01.717Z',
                        createdByUser: { userName: 'someone' },
                        tokens: [{ name: 'Treasure' }]
                    }
                )
            )
        ).toEqual({
            title: 'Sell list',
            editedAt: Date.parse('2026-09-14T22:39:01.717Z'),
            cards: [
                {
                    name: "Kroxa, Titan of Death's Hunger",
                    quantity: 1,
                    finish: 'nonfoil',
                    set: 'thb',
                    collectorNumber: '221',
                    scryfallId: ID,
                    image: IMAGE,
                    usd: 2.5
                },
                {
                    name: "Kroxa, Titan of Death's Hunger",
                    quantity: 2,
                    finish: 'foil',
                    set: 'thb',
                    collectorNumber: '221',
                    scryfallId: ID,
                    image: IMAGE,
                    usd: 3.25
                },
                // no etched price: left for Scryfall (list-prices.ts) to fill by the id
                {
                    name: 'Fire // Ice',
                    quantity: 1,
                    finish: 'etched',
                    set: 'thb',
                    collectorNumber: '221',
                    scryfallId: ID,
                    image: IMAGE
                }
            ]
        });
    });

    test('missing details are left out rather than guessed', () => {
        expect(
            parseMoxfield(
                deck({
                    mainboard: {
                        a: { quantity: 1, card: { name: 'Sol Ring' } },
                        b: {
                            quantity: 1,
                            finish: 'weird',
                            isFoil: true,
                            card: {
                                name: 'Sol Ring',
                                scryfall_id: 'not-an-id',
                                set: 7,
                                cn: 263,
                                prices: { usd_foil: 0 }
                            }
                        }
                    }
                })
            )
        ).toEqual({
            cards: [
                { name: 'Sol Ring', quantity: 1, finish: 'nonfoil' },
                { name: 'Sol Ring', quantity: 1, finish: 'foil' }
            ]
        });
    });

    test('malformed rows are skipped, the rest kept; repeated printings add up across boards', () => {
        expect(
            parseMoxfield(
                deck({
                    mainboard: {
                        a: row,
                        b: null,
                        c: { ...row, card: { ...row.card, name: '' } },
                        d: { ...row, card: { ...row.card, name: 42 } },
                        e: { ...row, quantity: 0 },
                        f: { ...row, quantity: '2' },
                        g: { ...row, quantity: 1.5 }
                    },
                    sideboard: { h: { ...row, quantity: 2 } }
                })
            )?.cards.map((c) => [c.name, c.quantity])
        ).toEqual([["Kroxa, Titan of Death's Hunger", 3]]);
    });

    test('an empty deck is an empty list', () => {
        expect(
            parseMoxfield(deck({}, { name: ' ', lastUpdatedAtUtc: 'never' }))
        ).toEqual({ cards: [] });
    });

    // an answer that isn't a deck is how a redesign shows up; the caller reports it rather than emptying the list
    test('not a deck → null', () => {
        expect(parseMoxfield('<html>blocked</html>')).toBeNull();
        expect(parseMoxfield('null')).toBeNull();
        expect(parseMoxfield('[]')).toBeNull();
        expect(parseMoxfield('{"name":"x"}')).toBeNull();
        expect(parseMoxfield('{"mainboard":[]}')).toBeNull();
    });
});
