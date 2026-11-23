import { describe, expect, test } from 'bun:test';
import { parseManabox } from '@/server/lists/parsers/manabox';
import { html } from '../../parser-fixtures';

// A page as Astro writes it: the props as [type, value] pairs (0 = value, 1 = array), HTML-escaped.
const astro = (v: unknown): unknown =>
    Array.isArray(v)
        ? [1, v.map(astro)]
        : [0, v && typeof v === 'object' ? astroObject(v) : v];
const astroObject = (o: object) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, astro(v)]));
const escape = (s: string) =>
    s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
const island = (name: string, props: string) =>
    `<astro-island uid="x" component-url="/_astro/deck.js" component-export="${name}" props="${props}" ssr client="load"></astro-island>`;
const page = (deck: unknown) =>
    island(
        'NabvarButtons',
        escape(JSON.stringify(astroObject({ slot: 'right-side' })))
    ) + island('Main', escape(JSON.stringify(astroObject({ deck }))));

const ID = 'd6c48f07-63b7-4a60-8da6-ce77405abf1e';
const IMAGE = `https://cards.scryfall.io/normal/front/d/6/${ID}.jpg?1783915073`;
const row = {
    name: 'Agatha of the Vile Cauldron',
    quantity: 1,
    variant: 'Normal',
    setId: 'WOE',
    collectorNumber: '199',
    pricing: {
        tcgplayer: {
            link: 'https://tcgplayer.example',
            value: 9.5600004196167
        },
        cardmarket: { value: 3.72 }
    },
    images: [
        {
            imageUrlSmall: 'https://cards.scryfall.io/small/x.jpg',
            imageUrlNormal: IMAGE
        }
    ]
};

describe('manabox', () => {
    test('shared deck: title, edit date and one row per printing', async () => {
        const list = parseManabox(await html('manabox-deck.html'));
        expect(list).not.toBeNull();
        expect(list!.title).toBe('Sell list v.2');
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
        expect(list!.cards.some((c) => c.name.includes(' // '))).toBe(true);
        expect(list).toMatchSnapshot();
    });

    test('reads a row: finish, printing, Scryfall id from the image, TCGplayer price to the cent', () => {
        expect(
            parseManabox(
                page({
                    name: '  Sell list  ',
                    editDate: 1794775247806,
                    cards: [
                        row,
                        {
                            ...row,
                            name: 'Fire // Ice',
                            variant: 'Foil',
                            quantity: 2
                        }
                    ]
                })
            )
        ).toEqual({
            title: 'Sell list',
            editedAt: 1794775247806,
            cards: [
                {
                    name: 'Agatha of the Vile Cauldron',
                    quantity: 1,
                    finish: 'nonfoil',
                    set: 'woe',
                    collectorNumber: '199',
                    scryfallId: ID,
                    image: IMAGE,
                    usd: 9.56
                },
                {
                    name: 'Fire // Ice',
                    quantity: 2,
                    finish: 'foil',
                    set: 'woe',
                    collectorNumber: '199',
                    scryfallId: ID,
                    image: IMAGE,
                    usd: 9.56
                }
            ]
        });
    });

    test('missing details are left out rather than guessed', () => {
        expect(
            parseManabox(
                page({
                    cards: [
                        { name: 'Sol Ring', quantity: 1 },
                        {
                            name: 'Sol Ring',
                            quantity: 1,
                            variant: 'Etched',
                            pricing: { tcgplayer: { value: 0 } },
                            images: [
                                {
                                    imageUrlNormal:
                                        'https://example.com/sol-ring.jpg'
                                }
                            ]
                        },
                        {
                            name: 'Counterspell',
                            quantity: 1,
                            pricing: { tcgplayer: { value: 0.001 } }
                        }
                    ]
                })
            )
        ).toEqual({
            cards: [
                { name: 'Sol Ring', quantity: 1, finish: 'nonfoil' },
                { name: 'Sol Ring', quantity: 1, finish: 'etched' },
                { name: 'Counterspell', quantity: 1, finish: 'nonfoil' }
            ]
        });
    });

    test('malformed rows are skipped, the rest kept; repeated printings add up', () => {
        expect(
            parseManabox(
                page({
                    cards: [
                        row,
                        null,
                        { ...row, name: '' },
                        { ...row, name: 42 },
                        { ...row, quantity: 0 },
                        { ...row, quantity: '2' },
                        { ...row, quantity: 1.5 },
                        { ...row, quantity: 2 }
                    ]
                })
            )?.cards.map((c) => [c.name, c.quantity])
        ).toEqual([['Agatha of the Vile Cauldron', 3]]);
    });

    test('an empty deck is an empty list', () => {
        expect(parseManabox(page({ name: '', cards: [] }))).toEqual({
            cards: []
        });
    });

    // Astro's other types (dates, maps, …) carry nothing the parser reads
    test('values in other Astro types are ignored', () => {
        const props = astroObject({ deck: { cards: [row] } }) as any;
        props.deck[1].name = [3, '2026-11-16T00:00:00.000Z'];
        props.deck[1].editDate = 'not a pair';
        props.deck[1].cards[1][0][1].setId = [7, 'https://example.com'];
        const list = parseManabox(
            island('Main', escape(JSON.stringify(props)))
        );
        expect(list?.title).toBeUndefined();
        expect(list?.editedAt).toBeUndefined();
        expect(list?.cards[0]?.set).toBeUndefined();
        expect(list?.cards[0]?.name).toBe('Agatha of the Vile Cauldron');
    });

    // a page without the deck is how a redesign shows up; the caller reports it rather than emptying the list
    test('no deck on the page → null', () => {
        expect(parseManabox('<html></html>')).toBeNull();
        expect(parseManabox(island('Other', escape('{}')))).toBeNull();
        expect(
            parseManabox('<astro-island component-export="Main">')
        ).toBeNull();
        expect(
            parseManabox(island('Main', '{&quot;deck&quot;:[0,{'))
        ).toBeNull();
        expect(parseManabox(page(null))).toBeNull();
        expect(parseManabox(page({ name: 'x' }))).toBeNull();
        expect(
            parseManabox(
                island(
                    'Main',
                    escape(JSON.stringify({ deck: [0, { cards: [0, 'x'] }] }))
                )
            )
        ).toBeNull();
        expect(
            parseManabox(
                island(
                    'Main',
                    escape(JSON.stringify({ deck: [0, { cards: [1, 'x'] }] }))
                )
            )
        ).toEqual({ cards: [] });
    });
});
