import { beforeEach, describe, expect, test } from 'bun:test';
import { openDatabase } from '@/server/db/database';
import { PriceCache } from '@/server/db/price-cache';
import type { StoredCard } from '@/server/db/list-store';
import { ListPrices } from '@/server/lists/list-prices';
import { ListRefreshFailure } from '@/server/lists/list-reader';
import { HttpError, ShopClient } from '@/server/outbound/shop-client';
import { captureLogs } from '../capture-logs';

captureLogs(); // the migration's log line

const DAY = 24 * 60 * 60_000;

type Identifier = { id?: string; name?: string; set?: string };
type Printing = Record<string, unknown>;

// Scryfall's printings, as /cards/collection would find them
const SOL_RING_C21 = {
    id: 'sol-c21',
    name: 'Sol Ring',
    set: 'c21',
    prices: { usd: '1.50', usd_foil: '4.00', usd_etched: null },
    image_uris: { normal: 'https://cards.scryfall.io/normal/sol-c21.jpg' }
};
const SOL_RING_DEFAULT = {
    ...SOL_RING_C21,
    id: 'sol-default',
    set: 'cmm',
    prices: { usd: '1.20', usd_foil: null, usd_etched: '9.99' }
};
const BONECRUSHER = {
    id: 'bone',
    name: 'Bonecrusher Giant // Stomp',
    set: 'eld',
    prices: { usd: '0.80' },
    card_faces: [
        {
            name: 'Bonecrusher Giant',
            image_uris: { normal: 'https://cards.scryfall.io/normal/bone.jpg' }
        },
        { name: 'Stomp' }
    ]
};
const ALL: Printing[] = [SOL_RING_C21, BONECRUSHER];

// A fake /cards/collection: answers each identifier from `printings` like Scryfall (by id, by name and set, or by
// name: the default printing, first listed), in the order asked, leaving out what it doesn't find.
function scryfall(
    printings: Printing[] = ALL,
    fail?: () => never,
    defaults: Printing[] = [SOL_RING_DEFAULT, BONECRUSHER]
) {
    const requests: Identifier[][] = [];
    const searches: string[] = [];
    const real = new ShopClient('https://api.scryfall.com');
    const client = {
        url: real.url.bind(real),
        fetchJson: async (url: string, init: RequestInit) => {
            // /cards/search?q=!"<name>" game:paper&unique=prints: every printing of the name, or a 404
            const search = new URL(url);
            if (search.pathname === '/cards/search') {
                expect(search.searchParams.get('unique')).toBe('prints');
                const name = search.searchParams
                    .get('q')!
                    .match(/^!"(.+)" game:paper$/)![1]!;
                searches.push(name);
                if (fail) fail();
                const data = printings.filter((p) => p.name === name);
                if (data.length === 0) throw new HttpError(404);
                return { object: 'list', data };
            }
            expect(url).toBe('https://api.scryfall.com/cards/collection');
            expect(init.method).toBe('POST');
            const { identifiers } = JSON.parse(init.body as string) as {
                identifiers: Identifier[];
            };
            requests.push(identifiers);
            if (fail) fail();
            const names = (p: Printing) => [
                p.name,
                ...((p.card_faces as { name: string }[]) ?? []).map(
                    (f) => f.name
                )
            ];
            const data = identifiers.flatMap((i) => {
                const found = i.id
                    ? printings.find((p) => p.id === i.id)
                    : (i.set ? printings : defaults).find(
                          (p) =>
                              // like Scryfall: a face's name, never the whole "A // B"
                              !i.name!.includes(' // ') &&
                              names(p).includes(i.name) &&
                              (!i.set || p.set === i.set)
                      );
                return found ? [found] : [];
            });
            return { object: 'list', data };
        }
    } as unknown as ShopClient;
    return { client, requests, searches };
}

// Cauldron Familiar's printings, as /cards/search lists them (some): the default, and two promos
const FAMILIAR_JMP = {
    id: 'fam-jmp',
    name: 'Cauldron Familiar',
    set: 'jmp',
    set_name: 'Jumpstart',
    promo_types: [],
    prices: { usd: '2.89', usd_foil: null },
    image_uris: { normal: 'https://cards.scryfall.io/normal/fam-jmp.jpg' }
};
const FAMILIAR_SCH = {
    ...FAMILIAR_JMP,
    id: 'fam-sch',
    set: 'sch',
    set_name: 'Store Championships',
    promo_types: ['storechampionship'],
    prices: { usd: '3.77', usd_foil: null },
    image_uris: { normal: 'https://cards.scryfall.io/normal/fam-sch.jpg' }
};
const FAMILIAR_PRE = {
    ...FAMILIAR_JMP,
    id: 'fam-pre',
    set: 'peld',
    set_name: 'Throne of Eldraine Promos',
    promo_types: ['prerelease', 'datestamped'],
    prices: { usd: '5.00', usd_foil: '6.00' },
    image_uris: { normal: 'https://cards.scryfall.io/normal/fam-pre.jpg' }
};
const FAMILIARS = [FAMILIAR_JMP, FAMILIAR_SCH, FAMILIAR_PRE];

const row = (card: Partial<StoredCard> & { name: string }): StoredCard => ({
    quantity: 1,
    finish: 'nonfoil',
    ...card
});

describe('ListPrices', () => {
    let cache: PriceCache;
    let slept: number[];
    const prices = (client: ShopClient) =>
        new ListPrices(client, cache, 1000, async (ms) => {
            slept.push(ms);
        });
    beforeEach(() => {
        cache = new PriceCache(openDatabase(':memory:'));
        slept = [];
    });

    test("rows with their own price (ManaBox's) are left as they are, without asking Scryfall", async () => {
        const { client, requests } = scryfall();
        const card = row({
            name: 'Sol Ring',
            usd: 2,
            scryfallId: 'sol-c21',
            image: 'x'
        });
        expect(await prices(client).price([card], 0)).toEqual([card]);
        expect(requests).toEqual([]);
    });

    test("a row with a set is priced as that set's printing, for its finish; a variant's price is approximate", async () => {
        const { client, requests } = scryfall();
        const priced = await prices(client).price(
            [
                row({ name: 'Sol Ring', set: 'c21' }),
                row({ name: 'Sol Ring', set: 'c21', finish: 'foil' }),
                row({ name: 'Sol Ring', set: 'c21', variant: 'retro' }),
                row({ name: 'Sol Ring', set: 'c21', finish: 'etched' })
            ],
            0
        );
        const image = 'https://cards.scryfall.io/normal/sol-c21.jpg';
        expect(priced).toEqual([
            row({
                name: 'Sol Ring',
                set: 'c21',
                usd: 1.5,
                image,
                scryfallId: 'sol-c21',
                approxPrice: false
            }),
            row({
                name: 'Sol Ring',
                set: 'c21',
                finish: 'foil',
                usd: 4,
                image,
                scryfallId: 'sol-c21',
                approxPrice: false
            }),
            row({
                name: 'Sol Ring',
                set: 'c21',
                variant: 'retro',
                usd: 1.5,
                image,
                scryfallId: 'sol-c21',
                approxPrice: true
            }),
            // no etched price: none, rather than another finish's
            row({
                name: 'Sol Ring',
                set: 'c21',
                finish: 'etched',
                image,
                scryfallId: 'sol-c21',
                approxPrice: false
            })
        ]);
        // one identifier per printing asked, however many rows share it
        expect(requests).toEqual([[{ name: 'Sol Ring', set: 'c21' }]]);
    });

    test("a row without a set gets Scryfall's default printing, approximately; a double-faced card's image is its front", async () => {
        const { client, requests } = scryfall();
        const priced = await prices(client).price(
            [
                row({ name: 'Sol Ring', finish: 'etched' }),
                row({ name: 'Bonecrusher Giant // Stomp' })
            ],
            0
        );
        expect(priced.map((c) => [c.usd, c.approxPrice, c.image])).toEqual([
            [9.99, true, 'https://cards.scryfall.io/normal/sol-c21.jpg'],
            [0.8, true, 'https://cards.scryfall.io/normal/bone.jpg']
        ]);
        expect(requests).toEqual([
            [{ name: 'Sol Ring' }, { name: 'Bonecrusher Giant' }]
        ]);
    });

    test("a set Scryfall doesn't know falls back to the name; a card it doesn't know has no price", async () => {
        const { client, requests } = scryfall();
        const priced = await prices(client).price(
            [
                row({ name: 'Sol Ring', set: 'xyz' }),
                row({ name: 'Brand New Card', set: 'new' })
            ],
            0
        );
        expect(priced).toEqual([
            row({
                name: 'Sol Ring',
                set: 'xyz',
                usd: 1.2,
                image: 'https://cards.scryfall.io/normal/sol-c21.jpg',
                scryfallId: 'sol-default',
                approxPrice: true
            }),
            row({ name: 'Brand New Card', set: 'new', approxPrice: true })
        ]);
        expect(requests).toEqual([
            [
                { name: 'Sol Ring', set: 'xyz' },
                { name: 'Brand New Card', set: 'new' }
            ],
            [{ name: 'Sol Ring' }, { name: 'Brand New Card' }]
        ]);
    });

    test('a ManaBox row without a price is asked for by its Scryfall id: the exact printing', async () => {
        const { client, requests } = scryfall();
        const [card] = await prices(client).price(
            [row({ name: 'Sol Ring', scryfallId: 'sol-c21', image: 'mine' })],
            0
        );
        expect(card).toEqual(
            row({
                name: 'Sol Ring',
                scryfallId: 'sol-c21',
                image: 'mine',
                usd: 1.5,
                approxPrice: false
            })
        );
        expect(requests).toEqual([[{ id: 'sol-c21' }]]);
    });

    test('prices are cached for a day, found or not', async () => {
        const { client, requests } = scryfall();
        const cards = [
            row({ name: 'Sol Ring', set: 'c21' }),
            row({ name: 'Nothing', set: 'zzz' })
        ];
        const first = await prices(client).price(cards, 0);
        expect(requests).toHaveLength(2); // the set lookups, then Nothing by name
        expect(await prices(client).price(cards, DAY - 1)).toEqual(first);
        expect(requests).toHaveLength(2);

        await prices(client).price(cards, DAY);
        expect(requests).toHaveLength(4);
        prices(client).purge(3 * DAY);
        expect(cache.get(['set:c21/sol ring'], 0).size).toBe(0);
    });

    test('75 identifiers a request, with a pause between requests', async () => {
        const { client, requests } = scryfall();
        const cards = Array.from({ length: 80 }, (_, i) =>
            row({ name: `Card ${i}` })
        );
        await prices(client).price(cards, 0);
        expect(requests.map((r) => r.length)).toEqual([75, 5]);
        expect(slept).toEqual([1000]);
    });

    test('Scryfall not answering fails the refresh, to be retried', async () => {
        const { client } = scryfall(ALL, () => {
            throw new HttpError(503);
        });
        const error = await prices(client)
            .price([row({ name: 'Sol Ring' })], 0)
            .catch((e) => e);
        expect(error).toBeInstanceOf(ListRefreshFailure);
        expect(error.reason).toBe('unavailable');
        expect(error.cause).toBeInstanceOf(HttpError);
    });

    // MTGGoldfish's "3 Cauldron Familiar <Store Championship> [PRM-MSC]": the promo group isn't a set, the <…> names it
    test('a promo is the printing its words name, exactly: price, image and Scryfall id', async () => {
        const { client, requests, searches } = scryfall(FAMILIARS);
        const [card] = await prices(client).price(
            [
                row({
                    name: 'Cauldron Familiar',
                    quantity: 3,
                    promo: 'MSC',
                    variant: 'Store Championship'
                })
            ],
            0
        );
        expect(card).toEqual({
            name: 'Cauldron Familiar',
            quantity: 3,
            finish: 'nonfoil',
            promo: 'MSC',
            variant: 'Store Championship',
            usd: 3.77,
            image: 'https://cards.scryfall.io/normal/fam-sch.jpg',
            scryfallId: 'fam-sch',
            approxPrice: false
        });
        expect(searches).toEqual(['Cauldron Familiar']);
        expect(requests).toEqual([]);
    });

    test("a promo group's own words count: a prerelease, by the group alone", async () => {
        const { client } = scryfall(FAMILIARS);
        const [card] = await prices(client).price(
            [
                row({
                    name: 'Cauldron Familiar',
                    finish: 'foil',
                    promo: 'PRE',
                    variant: 'promo'
                })
            ],
            0
        );
        expect([card?.scryfallId, card?.usd, card?.approxPrice]).toEqual([
            'fam-pre',
            6,
            false
        ]);
    });

    test("a promo the words don't single out falls back to the name, approximately", async () => {
        const { client, requests, searches } = scryfall(FAMILIARS, undefined, [
            FAMILIAR_JMP
        ]);
        const cards = await prices(client).price(
            [
                // no words, and the card has two promos
                row({
                    name: 'Cauldron Familiar',
                    promo: 'MSC',
                    variant: 'promo'
                }),
                // words no printing has
                row({
                    name: 'Cauldron Familiar',
                    promo: 'MSC',
                    variant: 'Anime'
                }),
                // a card Scryfall doesn't know: a 404
                row({
                    name: 'Nonexistent Card',
                    promo: 'MSC',
                    variant: 'promo'
                })
            ],
            0
        );
        expect(cards.map((c) => [c.scryfallId, c.usd, c.approxPrice])).toEqual([
            ['fam-jmp', 2.89, true],
            ['fam-jmp', 2.89, true],
            [undefined, undefined, true]
        ]);
        expect(searches).toEqual([
            'Cauldron Familiar',
            'Cauldron Familiar',
            'Nonexistent Card'
        ]);
        // the fallbacks share one collection request
        expect(requests).toEqual([
            [{ name: 'Cauldron Familiar' }, { name: 'Nonexistent Card' }]
        ]);
    });

    test('a card with a single promo is that promo, even without words', async () => {
        const { client } = scryfall([FAMILIAR_JMP, FAMILIAR_SCH]);
        const [card] = await prices(client).price(
            [
                row({
                    name: 'Cauldron Familiar',
                    promo: 'MSC',
                    variant: 'promo'
                })
            ],
            0
        );
        expect(card?.scryfallId).toBe('fam-sch');
    });

    test('promo searches pause like batches, and are cached for a day', async () => {
        const { client, requests, searches } = scryfall([...ALL, ...FAMILIARS]);
        const familiar = row({
            name: 'Cauldron Familiar',
            promo: 'MSC',
            variant: 'Store Championship'
        });
        const pre = row({ name: 'Cauldron Familiar', promo: 'PRE' });
        const solRing = row({ name: 'Sol Ring', set: 'c21' });
        await prices(client).price([familiar, pre, solRing], 0);
        expect(requests).toHaveLength(1);
        expect(searches).toHaveLength(2);
        expect(slept).toEqual([1000, 1000]);
        await prices(client).price([familiar, pre, solRing], DAY - 1);
        expect([requests.length, searches.length]).toEqual([1, 2]);
    });

    test("a promo search Scryfall doesn't answer fails the refresh", async () => {
        const { client } = scryfall(FAMILIARS, () => {
            throw new HttpError(503);
        });
        const error = await prices(client)
            .price([row({ name: 'Cauldron Familiar', promo: 'MSC' })], 0)
            .catch((e) => e);
        expect(error).toBeInstanceOf(ListRefreshFailure);
        expect(error.reason).toBe('unavailable');
    });

    test('an answer without data finds nothing', async () => {
        const client = {
            url: (p: string) => `https://api.scryfall.com${p}`,
            fetchJson: async () => ({ object: 'error' })
        } as unknown as ShopClient;
        const cards = await prices(client).price(
            [
                row({ name: 'Sol Ring' }),
                row({ name: 'Cauldron Familiar', promo: 'MSC' })
            ],
            0
        );
        expect(cards.map((c) => c.usd)).toEqual([undefined, undefined]);
    });

    test('by default it waits between requests, on its own clock', async () => {
        const { client } = scryfall();
        const cards = Array.from({ length: 76 }, (_, i) =>
            row({ name: `Card ${i}` })
        );
        const started = Date.now();
        await new ListPrices(client, cache, 1).price(cards);
        expect(Date.now() - started).toBeGreaterThanOrEqual(1);
        new ListPrices(client, cache).purge();
    });
});
