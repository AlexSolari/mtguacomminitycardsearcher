import { beforeEach, describe, expect, test } from 'bun:test';
import { openDatabase } from '@/server/db/database';
import { PriceCache } from '@/server/db/price-cache';
import type { StoredCard } from '@/server/db/list-store';
import { ListPrices } from '@/server/lists/list-prices';
import { ListRefreshFailure } from '@/server/lists/list-reader';
import { HttpError, ShopClient } from '@/server/shop-client';
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
    const real = new ShopClient('https://api.scryfall.com');
    const client = {
        url: real.url.bind(real),
        fetchJson: async (url: string, init: RequestInit) => {
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
    return { client, requests };
}

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

    test('an answer without data finds nothing', async () => {
        const client = {
            url: (p: string) => `https://api.scryfall.com${p}`,
            fetchJson: async () => ({ object: 'error' })
        } as unknown as ShopClient;
        const [card] = await prices(client).price(
            [row({ name: 'Sol Ring' })],
            0
        );
        expect(card?.usd).toBeUndefined();
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
