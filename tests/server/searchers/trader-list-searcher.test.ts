import { beforeEach, describe, expect, test } from 'bun:test';
import { openDatabase } from '@/server/db/database';
import { ListStore, type StoredCard } from '@/server/db/list-store';
import { UserStore } from '@/server/db/user-store';
import type { ListLink } from '@/server/lists/list-link';
import { TraderListSearcher } from '@/server/searchers/trader-list-searcher';
import { captureLogs } from '../capture-logs';

captureLogs(); // the migration's log line

const IMAGE = 'https://cards.scryfall.io/normal/front/sol-ring.jpg';

describe('TraderListSearcher', () => {
    let lists: ListStore;
    let searcher: TraderListSearcher;
    beforeEach(() => {
        const db = openDatabase(':memory:');
        const users = new UserStore(db);
        lists = new ListStore(db);
        searcher = new TraderListSearcher(lists);
        const alice = users.login(
            { telegramId: 1, username: 'alice_mtg', displayName: 'Alice' },
            0
        );
        // an approved list, read at 1_700_000_000_000
        const add = (
            link: ListLink,
            title: string | null,
            cards: StoredCard[]
        ) => {
            const list = lists.submit(alice.id, link, 0)!;
            lists.review(list.id, 'approved', 0);
            lists.saveCards(
                list.id,
                { ...(title && { title }), cards },
                1_700_000_000_000,
                1_800_000_000_000
            );
        };
        add({ source: 'manabox', ref: 'abc' }, 'Trades', [
            {
                name: 'Sol Ring',
                quantity: 2,
                finish: 'foil',
                set: 'c21',
                collectorNumber: '263',
                image: IMAGE,
                usd: 4
            },
            { name: 'Sol Ring', quantity: 1, finish: 'etched', set: 'cmm' }
        ]);
        add({ source: 'mtggoldfish', ref: '42' }, null, [
            {
                name: 'Sol Ring',
                quantity: 1,
                finish: 'nonfoil',
                set: 'rvr',
                variant: 'retro',
                usd: 1.5,
                approxPrice: true
            },
            {
                name: 'Bonecrusher Giant // Stomp',
                quantity: 3,
                finish: 'nonfoil',
                usd: 0.8,
                approxPrice: true
            }
        ]);
    });

    test("a card's rows in approved lists, as offers that open the trader's Telegram, priced in USD", async () => {
        expect(searcher.shop).toBe('traders');
        expect(await searcher.search('Sol Ring')).toEqual([
            {
                shop: 'traders',
                name: 'Sol Ring',
                url: 'https://t.me/alice_mtg',
                image: null,
                price: null,
                stock: 1,
                usdPrice: 1.5,
                approxPrice: true,
                seller: {
                    name: 'Alice',
                    username: 'alice_mtg',
                    list: 'https://www.mtggoldfish.com/deck/42',
                    listTitle: null,
                    updatedAt: 1_700_000_000_000,
                    printing: 'RVR · retro'
                }
            },
            {
                shop: 'traders',
                name: 'Sol Ring',
                url: 'https://t.me/alice_mtg',
                image: IMAGE,
                price: null,
                stock: 2,
                foil: true,
                usdPrice: 4,
                seller: {
                    name: 'Alice',
                    username: 'alice_mtg',
                    list: 'https://manabox.app/decks/abc',
                    listTitle: 'Trades',
                    updatedAt: 1_700_000_000_000,
                    printing: 'C21 · #263'
                }
            },
            // no price: none shown, rather than a guess
            {
                shop: 'traders',
                name: 'Sol Ring',
                url: 'https://t.me/alice_mtg',
                image: null,
                price: null,
                stock: 1,
                foil: true,
                seller: {
                    name: 'Alice',
                    username: 'alice_mtg',
                    list: 'https://manabox.app/decks/abc',
                    listTitle: 'Trades',
                    updatedAt: 1_700_000_000_000,
                    printing: 'CMM · etched'
                }
            }
        ]);
    });

    test("a double-faced card is found by the face shops search for, or the whole card's name", async () => {
        const offers = await searcher.search(
            'Bonecrusher Giant',
            undefined,
            'Bonecrusher Giant // Stomp'
        );
        expect(
            offers.map((o) => [o.name, o.stock, o.seller?.printing])
        ).toEqual([['Bonecrusher Giant // Stomp', 3, null]]);
        expect(await searcher.search('Bonecrusher Giant')).toEqual([]);
        expect(await searcher.search('Black Lotus')).toEqual([]);
    });
});
