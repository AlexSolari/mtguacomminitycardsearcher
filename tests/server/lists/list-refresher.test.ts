import { beforeEach, describe, expect, test } from 'bun:test';
import type { IndexedCard } from '@/server/search/card-index';
import { openDatabase } from '@/server/db/database';
import { ListStore, type StoredCard } from '@/server/db/list-store';
import { UserStore, type User } from '@/server/db/user-store';
import type { ListCard, ParsedList } from '@/server/lists/list-card';
import type { ListLink } from '@/server/lists/list-link';
import { ListRefreshFailure } from '@/server/lists/list-reader';
import {
    ListRefresher,
    MIN_GAP_MS,
    retryDelay
} from '@/server/lists/list-refresher';
import { isNight, nextSlot } from '@/server/lists/night-schedule';
import { captureLogs } from '../capture-logs';

const logs = captureLogs();
const HOUR = 60 * 60_000;
// 03:00 and 14:00 in Kyiv, 17 November 2026 (UTC+2)
const NIGHT = Date.UTC(2026, 10, 17, 1, 0);
const DAY = Date.UTC(2026, 10, 17, 12, 0);

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
    let users: UserStore;
    let alice: User;
    let now: number;
    let pages: Map<string, () => ParsedList | Promise<ParsedList>>;
    let read: string[];
    let purged: number[];
    let refresher: ListRefresher;

    beforeEach(() => {
        const db = openDatabase(':memory:');
        lists = new ListStore(db);
        users = new UserStore(db);
        alice = users.login(
            { telegramId: 1, username: 'alice', displayName: 'Alice' },
            0
        );
        now = NIGHT;
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

    test("reads each approved list that's due, under the cards' own names, and schedules the next read for its slot tomorrow night", async () => {
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
        const next = nextSlot(id, NIGHT + MIN_GAP_MS);
        expect(lists.get(id)).toMatchObject({
            fetchedAt: NIGHT,
            nextFetchAt: next,
            cardCount: 7,
            lastError: null
        });
        expect(isNight(next)).toBe(true);
        expect(next - NIGHT).toBeGreaterThan(MIN_GAP_MS);
        expect(next - NIGHT).toBeLessThan(28 * HOUR);
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
        expect(purged).toEqual([NIGHT]);

        // not due again until its slot
        await refresher.run();
        expect(read).toEqual(['1']);
        now = next;
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

    test('a failure keeps the cards, says why, and retries after 1, 2, 4… hours, then daily; never in the day', async () => {
        const id = approve(manabox);
        pages.set('abc', () => ({ title: 'Trades', cards: [row('Sol Ring')] }));
        await refresher.run();

        pages.set('abc', () => {
            throw new ListRefreshFailure('not-found');
        });
        logs.length = 0;
        now = lists.get(id)!.nextFetchAt!; // 03:37, the list's slot
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

        // two hours on from 04:37 is 06:37: still the night
        now += HOUR;
        await refresher.run();
        expect(lists.get(id)?.nextFetchAt).toBe(now + 2 * HOUR);
        // four hours on from 06:37 is the day: the slot the next night instead
        now += 2 * HOUR;
        await refresher.run();
        expect(lists.get(id)?.nextFetchAt).toBe(nextSlot(id, now + 4 * HOUR));
        expect(lists.get(id)?.nextFetchAt).toBeGreaterThan(now + 12 * HOUR);
        expect([1, 2, 3, 5, 6, 10].map(retryDelay)).toEqual([
            HOUR,
            2 * HOUR,
            4 * HOUR,
            16 * HOUR,
            24 * HOUR,
            24 * HOUR
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
        expect(lists.get(first)?.fetchedAt).toBe(NIGHT);
        expect(lists.get(second)?.fetchedAt).toBe(NIGHT);
    });

    test('run(ids) reads only those lists, in the day too, and leaves the rest for the night', async () => {
        const a = approve(goldfish);
        const b = approve(manabox);
        const pending = lists.submit(
            alice.id,
            { source: 'manabox', ref: 'p' },
            0
        )!;
        pages.set('1', () => ({ cards: [] }));
        pages.set('abc', () => ({ cards: [] }));
        now = DAY;
        await refresher.run([b, pending.id, 999]);
        expect(read).toEqual(['abc']);
        // read in the day, so next tonight, at its slot
        expect(lists.get(b)?.nextFetchAt).toBe(nextSlot(b, DAY));
        expect(lists.get(b)!.nextFetchAt! - DAY).toBeLessThan(17 * HOUR);
        expect(isNight(lists.get(b)!.nextFetchAt!)).toBe(true);
        // b isn't due any more: asking again reads nothing
        await refresher.run([b]);
        expect(read).toEqual(['abc']);
        // the night's check reads a
        await refresher.run();
        expect(read).toEqual(['abc', '1']);
        expect(lists.get(a)?.fetchedAt).toBe(DAY);
    });

    test('a list read late in the evening is read again that night, not the next', async () => {
        // 23:30 and 01:59 in Kyiv: the night's slots are a few hours away, less than MIN_GAP_MS
        for (const at of [
            Date.UTC(2026, 10, 17, 21, 30),
            Date.UTC(2026, 10, 17, 23, 59)
        ]) {
            const id = approve({ source: 'manabox', ref: String(at) });
            pages.set(String(at), () => ({ cards: [] }));
            now = at;
            await refresher.run([id]);
            const next = lists.get(id)!.nextFetchAt!;
            expect(isNight(next)).toBe(true);
            expect(next - at).toBeLessThan(8 * HOUR);
        }
    });

    test('a list read at night before its slot waits for tomorrow night', async () => {
        const id = approve(goldfish);
        pages.set('1', () => ({ cards: [] }));
        now = NIGHT; // 03:00
        await refresher.run([id]);
        const next = lists.get(id)!.nextFetchAt!;
        expect(next - NIGHT).toBeGreaterThanOrEqual(MIN_GAP_MS);
        expect(next - NIGHT).toBeLessThan(28 * HOUR);
    });

    test("a pass that fails is logged, doesn't reject, and doesn't stop lists asked for meanwhile", async () => {
        const a = approve(goldfish);
        const b = approve(manabox);
        pages.set('1', () => ({ cards: [] }));
        pages.set('abc', () => ({ cards: [] }));
        const due = lists.due.bind(lists);
        lists.due = () => {
            void refresher.run([b]); // asked for while the failing pass runs
            throw new Error('database is locked');
        };
        await refresher.run(); // resolves
        expect(read).toEqual(['abc']);
        expect(logs).toContainEqual(
            expect.objectContaining({
                level: 'error',
                message: 'list refresh pass failed'
            })
        );
        // the next pass runs as usual
        lists.due = due;
        await refresher.run();
        expect(read).toEqual(['abc', '1']);
        expect(lists.get(a)?.fetchedAt).toBe(now);
    });

    test('a failure while recording a failure is caught too', async () => {
        approve(goldfish); // no page: the read fails
        lists.saveFailure = () => {
            throw new Error('disk full');
        };
        await refresher.run();
        expect(logs.at(-1)).toMatchObject({
            level: 'error',
            message: 'list refresh pass failed'
        });
    });

    test('a list asked for again while it is being read is read once (a moderator clicking twice)', async () => {
        const id = approve(goldfish);
        pages.set('1', () => {
            lists.refreshNow([id], now); // it's due: refreshNow returns it again
            void refresher.run([id]);
            return { cards: [] };
        });
        await refresher.run([id]);
        expect(read).toEqual(['1']);
    });

    test("run(ids) leaves a banned user's lists unread", async () => {
        users.setBanned(alice.id, true);
        const id = approve(goldfish); // a moderator approves a banned user's list
        pages.set('1', () => ({ cards: [] }));
        now = DAY;
        await refresher.run([id]);
        expect(read).toEqual([]);
        expect(lists.get(id)?.fetchedAt).toBeNull();
    });

    test('lists asked for during a pass are read in one more pass; a check for all of them wins', async () => {
        const a = approve(goldfish);
        let b = 0;
        let c = 0;
        pages.set('1', () => {
            b = approve(manabox);
            c = approve({ source: 'manabox', ref: 'c' });
            void refresher.run([b]);
            void refresher.run([c]);
            return { cards: [] };
        });
        pages.set('abc', () => ({ cards: [] }));
        pages.set('c', () => ({ cards: [] }));
        await refresher.run([a]);
        expect(read).toEqual(['1', 'abc', 'c']);

        read.length = 0;
        const d = approve({ source: 'manabox', ref: 'd' });
        pages.set('d', () => {
            const e = approve({ source: 'manabox', ref: 'e' });
            void refresher.run([e]);
            void refresher.run();
            return { cards: [] };
        });
        pages.set('e', () => ({ cards: [] }));
        await refresher.run([d]);
        expect(read).toEqual(['d', 'e']);
    });

    test("a list whose result can't be saved is tried once per run, not forever", async () => {
        approve(goldfish);
        lists.saveFailure = () => {}; // leaves it due
        await refresher.run();
        expect(read).toEqual(['1']);
    });

    test('start checks every 5 minutes through the night in Kyiv, and at once if it starts at night; stop ends it', async () => {
        const jobs: { cron: string; tz: string; stopped: boolean }[] = [];
        let tick = (): unknown => undefined;
        const schedule = (
            cron: string,
            handler: () => unknown,
            { tz }: { tz: string }
        ) => {
            const job = { cron, tz, stopped: false };
            jobs.push(job);
            tick = handler;
            return { stop: () => (job.stopped = true) };
        };
        const id = approve(goldfish);
        pages.set('1', () => ({ cards: [] }));

        // started in the day: nothing until the night's check
        now = DAY;
        refresher.start(schedule);
        refresher.start(schedule); // a second start keeps the one job
        await Bun.sleep(1);
        expect(jobs).toEqual([
            { cron: '*/5 2-6 * * *', tz: 'Europe/Kyiv', stopped: false }
        ]);
        expect(read).toEqual([]);
        now = NIGHT;
        await tick();
        expect(read).toEqual(['1']);

        refresher.stop();
        expect(jobs[0]?.stopped).toBe(true);

        // started at night (a restart): at once
        now = lists.get(id)!.nextFetchAt!;
        refresher.start(schedule);
        await Bun.sleep(1);
        expect(read).toEqual(['1', '1']);
        refresher.stop();
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
        r.start(); // Bun.cron
        r.stop();
    });
});
