import { describe, expect, test } from 'bun:test';
import { parseMtggoldfish } from '@/server/lists/parsers/mtggoldfish';
import { html } from '../../parsers/parser-fixtures';

const page = (lines: string) =>
    `<html><body><form><textarea name="deck" id="deck" class="form-control deck-pricer-deck-input">\n${lines}\n</textarea></form></body></html>`;

describe('mtggoldfish', () => {
    test('proxies page: one row per printing', async () => {
        const list = parseMtggoldfish(await html('mtggoldfish-proxies.html'));
        expect(list).not.toBeNull();
        expect(list!.title).toBeUndefined();
        expect(list!.cards.length).toBeGreaterThan(0);
        for (const card of list!.cards) {
            expect(card.name).not.toMatch(/^\s|\s$|[<>[\]]|\(F\)/);
            expect(card.quantity).toBeGreaterThan(0);
            if (card.set) expect(card.set).toMatch(/^[a-z0-9]{2,6}$/);
        }
        expect(list!.cards.some((c) => c.finish === 'foil')).toBe(true);
        expect(list!.cards.some((c) => c.variant)).toBe(true);
        expect(list).toMatchSnapshot();
    });

    test('reads quantity, name, treatment, set and foil; promo groups name no set, only "promo"', () => {
        expect(
            parseMtggoldfish(
                page(
                    [
                        '1 Sacred Foundry &lt;retro&gt; [RVR]',
                        '2 Boseiju, Who Endures [NEO]',
                        '1 Lotus Bloom [PRM-PRE] (F)',
                        '4x Green Sun&#39;s Zenith',
                        '1 Raph &amp; Mikey, Troublemakers &lt;promo pack&gt; [TMT] (F)',
                        '1 Fire // Ice',
                        '1 Gaea&#39;s Will &lt;retro&gt; [MH2] (FE)',
                        '1 Sol Ring [C21] (X)',
                        '1 B.F.M. (Big Furry Monster)',
                        '3 Cauldron Familiar &lt;Store Championship&gt; [PRM-MSC]'
                    ].join('\r\n')
                )
            )
        ).toEqual({
            cards: [
                {
                    name: 'Sacred Foundry',
                    quantity: 1,
                    finish: 'nonfoil',
                    set: 'rvr',
                    variant: 'retro'
                },
                {
                    name: 'Boseiju, Who Endures',
                    quantity: 2,
                    finish: 'nonfoil',
                    set: 'neo'
                },
                {
                    name: 'Lotus Bloom',
                    quantity: 1,
                    finish: 'foil',
                    promo: 'PRE',
                    variant: 'promo'
                },
                { name: "Green Sun's Zenith", quantity: 4, finish: 'nonfoil' },
                {
                    name: 'Raph & Mikey, Troublemakers',
                    quantity: 1,
                    finish: 'foil',
                    set: 'tmt',
                    variant: 'promo pack'
                },
                { name: 'Fire // Ice', quantity: 1, finish: 'nonfoil' },
                {
                    name: "Gaea's Will",
                    quantity: 1,
                    finish: 'etched',
                    set: 'mh2',
                    variant: 'retro'
                },
                // an unknown marker is left out of the name; the finish stays the plain one
                {
                    name: 'Sol Ring',
                    quantity: 1,
                    finish: 'nonfoil',
                    set: 'c21'
                },
                {
                    name: 'B.F.M. (Big Furry Monster)',
                    quantity: 1,
                    finish: 'nonfoil'
                },
                // a promo's <…> is its variant, which list-prices.ts finds the printing by
                {
                    name: 'Cauldron Familiar',
                    quantity: 3,
                    finish: 'nonfoil',
                    promo: 'MSC',
                    variant: 'Store Championship'
                }
            ]
        });
    });

    test('every section counts: the same printing adds up, other printings stay apart', () => {
        expect(
            parseMtggoldfish(
                page(
                    [
                        '2 Green Sun&#39;s Zenith [MBS]',
                        '1 Green Sun&#39;s Zenith [EMA]',
                        'sideboard',
                        '1 Green Sun&#39;s Zenith [MBS]'
                    ].join('\n')
                )
            )?.cards
        ).toEqual([
            {
                name: "Green Sun's Zenith",
                quantity: 3,
                finish: 'nonfoil',
                set: 'mbs'
            },
            {
                name: "Green Sun's Zenith",
                quantity: 1,
                finish: 'nonfoil',
                set: 'ema'
            }
        ]);
    });

    test('lines that are no card are skipped', () => {
        expect(
            parseMtggoldfish(
                page(
                    ['Deck', '', '0 Sol Ring', 'Sol Ring', '3', '  '].join('\n')
                )
            )
        ).toEqual({ cards: [] });
    });

    // a page without the deck field is how a redesign shows up; the caller reports it rather than emptying the list
    test('no deck field → null', () => {
        expect(parseMtggoldfish('<html></html>')).toBeNull();
        expect(
            parseMtggoldfish('<textarea id="notes">1 Sol Ring</textarea>')
        ).toBeNull();
    });
});
