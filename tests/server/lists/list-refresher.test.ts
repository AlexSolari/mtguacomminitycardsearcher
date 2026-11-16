import { beforeEach, describe, expect, test } from 'bun:test';
import type { IndexedCard } from '@/server/card-index';
import { openDatabase } from '@/server/db/database';
import { ListStore, type StoredCard } from '@/server/db/list-store';
import { UserStore, type User } from '@/server/db/user-store';
import type { ListCard, ParsedList } from '@/server/lists/list-card';
import type { ListLink } from '@/server/lists/list-link';
import { ListRefreshFailure } from '@/server/lists/list-reader';
import {
    ListRefresher,
    REFRESH_MS,
    retryDelay
} from '@/server/lists/list-refresher';
import { captureLogs } from '../capture-logs';

const logs = captureLogs();
const HOUR = 60 * 60_000;

const goldfish: ListLink = { source: 'mtggoldfish', ref: '1' };
const manabox: ListLink = { source: 'manabox', ref: 'abc' };

const INDEX: Record<string, IndexedCard> = {
    'sol ring': { name: 'Sol Ring' },
    'bonecrusher giant': {
        name: 'Bonecrusher Giant // Stomp',
        card_faces: [{ name: 'Bonecrusher Giant' }, { name: 'Stomp' }]
    },
    // the index's typo search: a loose match, not this card
    'sol rong': { name: 'Sol Ring' }
};
const index = { find: (name: string) => INDEX[name.toLowerCase()] };

const row = (name: string, quantity = 1): ListCard => ({
    name,
    quantity,
    finish: 'nonfoil'
});

describe('ListRefresher', () => {
    let lists: ListStore;
    let alice: User;
    let now: number;
    let pages: Map<string, () => ParsedList | Promise<ParsedList>>;
    let read: string[];
    let purged: number[];
    let refresher: ListRefresher;

    beforeEach(() => {
        const db = openDatabase(':memory:');
        lists = new ListStore(db);
        alice = new UserStore(db).login(
            { telegramId: 1, username: 'alice', displayName: 'Alice' },
            0
        );
        now = 1000;
        pages = new Map();
        read = [];
        purged = [];
        refresher = new ListRefresher(
            lists,
            {
                read: async (link) => {
                    read.push(link.ref);
                    const page = pages.get(link.ref);
                    if (!page) throw new Error('no page');
                    return page();
                }
            },
            {
                // a dollar a copy, approximate when the list names no set
                price: async (cards) =>
                    cards.map((c): StoredCard => ({
                        ...c,
                        usd: 1,
                        approxPrice: !c.set
                    })),
                purge: (at) => void purged.push(at ?? -1)
            },
            index,
            () => now
        );
        logs.length = 0; // the migration's log line
    });

    const approve = (link: ListLink) => {
        const list = lists.submit(alice.id, link, 0)!;
        lists.review(list.id, 'approved', now);
        return list.id;
    };
    const cardsOf = (id: number) =>
        lists.offers('Sol Ring').filter((o) => o.listId === id);

    test("reads each approved list that's due, under the cards' own names, and schedules the next read a day on", async () => {
        const id = approve(goldfish);
        lists.submit(alice.id, manabox, 0); // pending: never read
        pages.set('1', () => ({
            cards: [
                row('sol ring', 2),
                { ...row('Sol Ring'), set: 'c21' },
                row('SOL RING'),
                row('Bonecrusher Giant'),
                row('Sol Rong'),
                row('Brand New Card')
            ]
        }));
        await refresher.run();

        expect(read).toEqual(['1']);
        expect(lists.get(id)).toMatchObject({
            fetchedAt: 1000,
            nextFetchAt: 1000 + REFRESH_MS,
            cardCount: 7,
            lastError: null
        });
        // spellings of one card are one row; the index's loose match isn't trusted
        expect(cardsOf(id).map((o) => [o.name, o.quantity, o.set])).toEqual([
            ['Sol Ring', 3, null],
            ['Sol Ring', 1, 'c21']
        ]);
        expect(
            lists.offers('Bonecrusher Giant', 'Bonecrusher Giant // Stomp')
        ).toMatchObject([{ name: 'Bonecrusher Giant // Stomp', usd: 1 }]);
        expect(lists.offers('Sol Rong')).toHaveLength(1);
        expect(lists.offers('Brand New Card')).toHaveLength(1);
        expect(logs).toMatchObject([
            {
                message: 'list refreshed',
                list: id,
                source: 'mtggoldfish',
                rows: 5
            }
        ]);
        expect(purged).toEqual([1000]);

        // not due again until tomorrow
        await refresher.run();
        expect(read).toEqual(['1']);
        now += REFRESH_MS;
        await refresher.run();
        expect(read).toEqual(['1', '1']);
    });

    test('without an index, names are kept as the list has them', async () => {
        const plain = new ListRefresher(
            lists,
            { read: async () => ({ cards: [row('sol ring')] }) },
            { price: async (cards) => cards, purge: () => {} },
            undefined,
            () => now
        );
        const id = approve(goldfish);
        await plain.run();
        expect(cardsOf(id).map((o) => o.name)).toEqual(['sol ring']);
    });

    test('a failure keeps the cards, says why, and retries after 1, 2, 4… hours, then daily', async () => {
        const id = approve(manabox);
        pages.set('abc', () => ({ title: 'Trades', cards: [row('Sol Ring')] }));
        await refresher.run();

        pages.set('abc', () => {
            throw new ListRefreshFailure('not-found');
        });
        logs.length = 0;
        now += REFRESH_MS;
        await refresher.run();
        expect(lists.get(id)).toMatchObject({
            title: 'Trades',
            cardCount: 1,
            lastError: 'not-found',
            failures: 1,
            nextFetchAt: now + HOUR
        });
        expect(cardsOf(id)).toHaveLength(1);
        expect(logs).toMatchObject([
            {
                level: 'warn',
                message: 'list refresh failed',
                list: id,
                source: 'manabox',
                reason: 'not-found',
                failures: 1
            }
        ]);

        now += HOUR;
        await refresher.run();
        expect(lists.get(id)?.nextFetchAt).toBe(now + 2 * HOUR);
        expect([1, 2, 3, 5, 6, 10].map(retryDelay)).toEqual([
            HOUR,
            2 * HOUR,
            4 * HOUR,
            16 * HOUR,
            REFRESH_MS,
            REFRESH_MS
        ]);
    });

    test("an unexpected error is logged as one, and the list is retried as if the source hadn't answered", async () => {
        const id = approve(goldfish); // no page: the fake reader throws a plain Error
        await refresher.run();
        expect(lists.get(id)).toMatchObject({
            lastError: 'unavailable',
            failures: 1
        });
        expect(logs).toMatchObject([
            { level: 'error', message: 'list refresh failed', list: id }
        ]);
    });

    test('a list deleted while it was being read is let go quietly', async () => {
        const id = approve(goldfish);
        pages.set('1', () => {
            lists.remove(id, alice.id);
            return { cards: [row('Sol Ring')] };
        });
        await refresher.run();
        expect(lists.get(id)).toBeNull();
        expect(logs).toEqual([]);
    });

    test('a list approved during a run is read before the run ends', async () => {
        const first = approve(goldfish);
        let second = 0;
        pages.set('1', () => {
            // approval calls run() while this run is busy
            second = approve(manabox);
            void refresher.run();
            return { cards: [] };
        });
        pages.set('abc', () => ({ cards: [] }));
        await refresher.run();
        expect(read).toEqual(['1', 'abc']);
        expect(lists.get(first)?.fetchedAt).toBe(1000);
        expect(lists.get(second)?.fetchedAt).toBe(1000);
    });

    test("a list whose result can't be saved is tried once per run, not forever", async () => {
        approve(goldfish);
        lists.saveFailure = () => {}; // leaves it due
        await refresher.run();
        expect(read).toEqual(['1']);
    });

    test('start reads at once and then every tick; stop ends it', async () => {
        approve(goldfish);
        pages.set('1', () => ({ cards: [] }));
        refresher.start(10);
        refresher.start(10); // a second start keeps the one timer
        await Bun.sleep(1);
        expect(read).toEqual(['1']);
        now += REFRESH_MS;
        await Bun.sleep(30);
        refresher.stop();
        const reads = read.length;
        expect(reads).toBeGreaterThanOrEqual(2);
        now += REFRESH_MS;
        await Bun.sleep(30);
        expect(read).toHaveLength(reads);
    });

    test('by default it runs on the real clock', async () => {
        const db = openDatabase(':memory:');
        const r = new ListRefresher(
            new ListStore(db),
            {
                read: async () => ({ cards: [] })
            } as never,
            { price: async () => [], purge: () => {} }
        );
        await r.run();
    });
});
