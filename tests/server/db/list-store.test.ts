import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDatabase } from '@/server/db/database';
import { ListStore, type StoredCard } from '@/server/db/list-store';
import { UserStore, type User } from '@/server/db/user-store';
import type { ListLink } from '@/server/lists/list-link';
import { captureLogs } from '../capture-logs';

captureLogs(); // the migration's log line

const goldfish = { source: 'mtggoldfish', ref: '6906342' } as const;
const manabox = { source: 'manabox', ref: 'Qsjv6XwMQ_SynKoo3V-epw' } as const;
const DAY = 24 * 60 * 60_000;

const solRing: StoredCard = {
    name: 'Sol Ring',
    quantity: 2,
    finish: 'nonfoil',
    set: 'c21',
    collectorNumber: '263',
    scryfallId: '00000000-0000-0000-0000-000000000001',
    image: 'https://cards.scryfall.io/normal/front/0/0/sol-ring.jpg',
    usd: 1.5
};
const bonecrusher: StoredCard = {
    name: 'Bonecrusher Giant // Stomp',
    quantity: 1,
    finish: 'foil',
    variant: 'showcase',
    usd: 3,
    approxPrice: true
};

describe('ListStore', () => {
    let db: Database;
    let users: UserStore;
    let lists: ListStore;
    let alice: User;
    let bob: User;
    beforeEach(() => {
        db = openDatabase(':memory:');
        users = new UserStore(db);
        lists = new ListStore(db);
        alice = users.login(
            { telegramId: 1, username: 'alice', displayName: 'Alice' },
            0
        );
        bob = users.login(
            { telegramId: 2, username: 'bob', displayName: 'Bob' },
            0
        );
    });

    // an approved list with cards, as after its first refresh
    const approved = (
        user: User,
        link: ListLink = goldfish,
        cards = [solRing]
    ) => {
        const list = lists.submit(user.id, link, 100)!;
        lists.review(list.id, 'approved', 200);
        lists.saveCards(list.id, { cards }, 300, 300 + DAY);
        return list;
    };

    test('a submitted list waits for review, off the refresh schedule', () => {
        expect(lists.submit(alice.id, goldfish, 100)).toEqual({
            id: expect.any(Number),
            userId: alice.id,
            source: 'mtggoldfish',
            ref: '6906342',
            title: null,
            status: 'pending',
            createdAt: 100,
            reviewedAt: null,
            editedAt: null,
            fetchedAt: null,
            nextFetchAt: null,
            lastError: null,
            failures: 0,
            cardCount: 0
        });
        expect(lists.due(Number.MAX_SAFE_INTEGER)).toEqual([]);
    });

    test('a list can be submitted once, by anyone', () => {
        expect(lists.submit(alice.id, goldfish)).not.toBeNull();
        expect(lists.submit(alice.id, goldfish)).toBeNull();
        expect(lists.submit(bob.id, goldfish)).toBeNull();
        expect(
            lists.submit(bob.id, { source: 'manabox', ref: goldfish.ref })
        ).not.toBeNull();
    });

    test('ofUser: own lists only, newest first', () => {
        const first = lists.submit(alice.id, goldfish, 100)!;
        const second = lists.submit(alice.id, manabox, 200)!;
        lists.submit(bob.id, { source: 'mtggoldfish', ref: '1' }, 300);
        expect(lists.ofUser(alice.id).map((l) => l.id)).toEqual([
            second.id,
            first.id
        ]);
        expect(lists.get(first.id)).toEqual(first);
        expect(lists.get(999)).toBeNull();
    });

    test('remove: only the owner can delete a list, and its cards go with it', () => {
        const list = approved(alice);
        expect(lists.remove(list.id, bob.id)).toBe(false);
        expect(lists.remove(list.id, alice.id)).toBe(true);
        expect(lists.get(list.id)).toBeNull();
        expect(db.query('SELECT * FROM list_cards').all()).toEqual([]);
    });

    test('moderation queue: pending lists, oldest first, with their owner', () => {
        const a = lists.submit(alice.id, goldfish, 200)!;
        const b = lists.submit(bob.id, manabox, 100)!;
        expect(
            lists.withStatus('pending').map((l) => [l.id, l.username])
        ).toEqual([
            [b.id, 'bob'],
            [a.id, 'alice']
        ]);
        lists.review(a.id, 'rejected', 300);
        expect(lists.withStatus('rejected')).toEqual([
            {
                ...a,
                status: 'rejected',
                reviewedAt: 300,
                username: 'alice',
                displayName: 'Alice',
                banned: false
            }
        ]);
        users.setBanned(alice.id, true);
        expect(lists.withStatus('rejected')[0]?.banned).toBe(true);
        expect(lists.review(999, 'approved')).toBe(false);
    });

    test('approval makes the list due at once; rejection takes it off the schedule', () => {
        const list = lists.submit(alice.id, goldfish, 100)!;
        expect(lists.review(list.id, 'approved', 200)).toBe(true);
        expect(lists.get(list.id)).toMatchObject({
            status: 'approved',
            reviewedAt: 200,
            nextFetchAt: 200
        });
        expect(lists.due(199)).toEqual([]);
        expect(lists.due(200).map((l) => l.id)).toEqual([list.id]);

        lists.review(list.id, 'rejected', 300);
        expect(lists.get(list.id)?.nextFetchAt).toBeNull();
        expect(lists.due(Number.MAX_SAFE_INTEGER)).toEqual([]);
    });

    test('due: most overdue first, up to the limit, not banned users', () => {
        const a = lists.submit(alice.id, goldfish, 0)!;
        const b = lists.submit(bob.id, manabox, 0)!;
        const c = lists.submit(
            alice.id,
            { source: 'mtggoldfish', ref: '7' },
            0
        )!;
        lists.review(a.id, 'approved', 300);
        lists.review(b.id, 'approved', 100);
        lists.review(c.id, 'approved', 200);
        expect(lists.due(1000).map((l) => l.id)).toEqual([b.id, c.id, a.id]);
        expect(lists.due(1000, 2).map((l) => l.id)).toEqual([b.id, c.id]);
        users.setBanned(alice.id, true);
        expect(lists.due(1000).map((l) => l.id)).toEqual([b.id]);
    });

    test('saveCards replaces the cards and records the refresh', () => {
        const list = approved(alice, manabox, [solRing, bonecrusher]);
        lists.saveCards(
            list.id,
            {
                title: 'Sell list',
                editedAt: 250,
                cards: [{ ...solRing, quantity: 4 }]
            },
            400,
            400 + DAY
        );
        expect(lists.get(list.id)).toMatchObject({
            title: 'Sell list',
            editedAt: 250,
            fetchedAt: 400,
            nextFetchAt: 400 + DAY,
            cardCount: 4
        });
        expect(lists.offers('Sol Ring').map((o) => o.quantity)).toEqual([4]);
        expect(lists.offers('Bonecrusher Giant')).toEqual([]);
    });

    test('a failure keeps the cards and counts up; the next success clears it', () => {
        const list = approved(alice);
        lists.saveFailure(list.id, 'HTTP 503', 1000);
        lists.saveFailure(list.id, 'HTTP 503', 2000);
        expect(lists.get(list.id)).toMatchObject({
            lastError: 'HTTP 503',
            failures: 2,
            fetchedAt: 300,
            nextFetchAt: 2000
        });
        expect(lists.offers('Sol Ring')).toHaveLength(1);

        lists.saveUnchanged(list.id, 3000, 3000 + DAY);
        expect(lists.get(list.id)).toMatchObject({
            lastError: null,
            failures: 0,
            fetchedAt: 3000,
            nextFetchAt: 3000 + DAY,
            cardCount: 2
        });
    });

    test('offers: what approved lists have of a card, cheapest first, with the list and its seller', () => {
        const a = approved(alice, goldfish, [solRing]);
        approved(bob, manabox, [
            { ...solRing, usd: 1, finish: 'etched' },
            bonecrusher
        ]);
        lists.submit(bob.id, { source: 'mtggoldfish', ref: '9' }); // pending: never searched
        expect(lists.offers('Sol Ring')[1]).toEqual({
            listId: a.id,
            source: 'mtggoldfish',
            ref: '6906342',
            title: null,
            fetchedAt: 300,
            username: 'alice',
            displayName: 'Alice',
            name: 'Sol Ring',
            quantity: 2,
            finish: 'nonfoil',
            set: 'c21',
            collectorNumber: '263',
            variant: null,
            image: 'https://cards.scryfall.io/normal/front/0/0/sol-ring.jpg',
            usd: 1.5,
            approxPrice: false
        });
        expect(
            lists.offers('sol ring').map((o) => [o.username, o.usd])
        ).toEqual([
            ['bob', 1],
            ['alice', 1.5]
        ]);
    });

    test('offers: a double-faced card is found by its front face or its full name', () => {
        approved(alice, goldfish, [bonecrusher]);
        approved(bob, manabox, [
            { ...bonecrusher, name: 'Bonecrusher Giant', usd: undefined }
        ]);
        const found = (card: string, full?: string) =>
            lists
                .offers(card, full)
                .map((o) => [o.username, o.usd, o.approxPrice]);
        expect(
            found('Bonecrusher Giant', 'Bonecrusher Giant // Stomp')
        ).toEqual([
            ['alice', 3, true],
            ['bob', null, true]
        ]);
        expect(found('Bonecrusher Giant')).toEqual([['bob', null, true]]);
    });

    test('offers: rejected lists and banned sellers are left out', () => {
        const a = approved(alice);
        approved(bob, manabox);
        users.setBanned(bob.id, true);
        expect(lists.offers('Sol Ring').map((o) => o.username)).toEqual([
            'alice'
        ]);
        lists.review(a.id, 'rejected');
        expect(lists.offers('Sol Ring')).toEqual([]);
    });
});
