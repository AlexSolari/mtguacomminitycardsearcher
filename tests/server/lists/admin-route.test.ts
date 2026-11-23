import { beforeEach, describe, expect, test } from 'bun:test';
import type { ModeratedList, ModeratedSeller } from '@/shared/account';
import { openDatabase } from '@/server/db/database';
import { ListStore } from '@/server/lists/list-store';
import { UserStore, type User } from '@/server/auth/user-store';
import { adminHandlers, MAX_SEARCH_RESULTS } from '@/server/lists/admin-route';
import { captureLogs } from '../capture-logs';
import {
    BASE,
    GOLDFISH,
    MANABOX,
    users,
    lists,
    alice,
    bob,
    mod,
    due,
    routes,
    request,
    submit,
    add,
    mine,
    queue,
    review,
    ban,
    setUpRoutes
} from './route-fixture';

const logs = captureLogs();

describe('admin routes', () => {
    beforeEach(() => {
        setUpRoutes();
        logs.length = 0; // the migration's log line
    });

    test('moderation needs a moderator', async () => {
        expect(
            (await routes.queue(request('/api/admin/lists', alice))).status
        ).toBe(403);
        expect((await review(1, 'approved', alice)).status).toBe(403);
        expect((await ban(bob.id, true, alice)).status).toBe(403);
        expect(
            (await routes.queue(request('/api/admin/lists', null))).status
        ).toBe(401);
    });

    test('the queue lists pending lists with their owner; approving reads the list at once', async () => {
        const a = await add(alice, GOLDFISH);
        const b = await add(bob, MANABOX);
        expect(await queue()).toEqual([
            {
                ...a,
                reviewedAt: null,
                owner: {
                    id: alice.id,
                    username: 'alice',
                    displayName: 'ALICE',
                    banned: false,
                    usdRate: null
                }
            },
            {
                ...b,
                reviewedAt: null,
                owner: {
                    id: bob.id,
                    username: 'bob',
                    displayName: 'BOB',
                    banned: false,
                    usdRate: null
                }
            }
        ]);

        logs.length = 0;
        expect((await review(a.id, 'approved')).status).toBe(204);
        expect((await review(b.id, 'rejected')).status).toBe(204);
        expect(due).toEqual([a.id]);
        expect(lists.get(a.id)).toMatchObject({
            status: 'approved',
            nextFetchAt: 1000
        });
        expect(await queue()).toEqual([]);
        expect((await queue('approved')).map((l) => l.id)).toEqual([a.id]);
        expect((await queue('rejected')).map((l) => l.id)).toEqual([b.id]);
        expect((await mine(bob)).lists[0]?.status).toBe('rejected');
        expect(logs.map((l) => [l.message, l.list, l.status])).toEqual([
            ['list reviewed', a.id, 'approved'],
            ['list reviewed', b.id, 'rejected']
        ]);
        expect(logs[0]?.moderator).toBe(mod.id);
    });

    test('a moderator searches lists in any state by seller, name, title or link', async () => {
        const search = async (q: string, user = mod) => {
            const res = await routes.queue(
                request(`/api/admin/lists?${new URLSearchParams({ q })}`, user)
            );
            expect(res.status).toBe(200);
            return ((await res.json()) as ModeratedList[]).map((l) => l.id);
        };
        const olena = users.login(
            { telegramId: 9, username: 'olena_cards', displayName: 'Олена' },
            0
        );
        const a = await add(alice, GOLDFISH);
        const b = await add(bob, MANABOX);
        const c = await add(
            olena,
            'https://moxfield.com/decks/q8YrkjxqgUSG0GQ3m9aQMQ'
        );
        await review(a.id, 'approved');
        await review(b.id, 'rejected');
        lists.saveCards(a.id, { title: 'Modern Burn', cards: [] }, 1000, 2000);

        // seller: @username, a piece of it, or the Telegram name, any case (Cyrillic too)
        expect(await search('@bob')).toEqual([b.id]);
        // "@" is the start of a username: what "Показати списки" sends
        expect(await search('@ali')).toEqual([a.id]);
        expect(await search('@lice')).toEqual([]);
        expect(await search('lice')).toEqual([a.id]);
        expect(await search('ALI')).toEqual([a.id]);
        expect(await search('олена')).toEqual([c.id]);
        // the list's title
        expect(await search('burn')).toEqual([a.id]);
        // its link, pasted however the source spells it, or a piece of it
        expect(
            await search('https://www.mtggoldfish.com/deck/download/6906342')
        ).toEqual([a.id]);
        expect(
            await search(
                'https://moxfield.com/decks/q8YrkjxqgUSG0GQ3m9aQMQ/primer'
            )
        ).toEqual([c.id]);
        expect(await search('manabox.app')).toEqual([b.id]);
        // newest first, whatever the state
        expect(await search('.')).toEqual([c.id, b.id, a.id]);
        expect(await search('nobody')).toEqual([]);
        // a blank search is the queue
        expect(await search('  ')).toEqual([c.id]);
        expect(
            (await routes.queue(request('/api/admin/lists?q=x', alice))).status
        ).toBe(403);
    });

    test('moderators list the sellers, and search them by @username or name', async () => {
        const sellers = async (q = '', user = mod) => {
            const res = await routes.sellers(
                request(
                    `/api/admin/sellers?${new URLSearchParams({ q })}`,
                    user
                )
            );
            expect(res.status).toBe(200);
            return (await res.json()) as ModeratedSeller[];
        };
        const olena = users.login(
            { telegramId: 9, username: 'olena_cards', displayName: 'Олена' },
            5
        );
        const list = await add(alice, GOLDFISH);
        await review(list.id, 'approved');
        await submit(alice, MANABOX);
        users.setUsdRate(alice.id, 42);
        users.setBanned(bob.id, true);

        const all = await sellers();
        // most recently signed in first; ties newest account first
        expect(all.map((s) => s.username)).toEqual([
            'olena_cards',
            'mod',
            'bob',
            'alice'
        ]);
        expect(all.find((s) => s.username === 'alice')).toEqual({
            id: alice.id,
            username: 'alice',
            displayName: 'ALICE',
            banned: false,
            admin: false,
            usdRate: 42,
            createdAt: 0,
            lastLoginAt: 0,
            lists: { pending: 1, approved: 1, rejected: 0 }
        });
        expect(all.find((s) => s.username === 'bob')?.banned).toBe(true);
        expect(all.find((s) => s.username === 'mod')?.admin).toBe(true);

        const names = async (q: string) =>
            (await sellers(q)).map((s) => s.username);
        expect(await names('@al')).toEqual(['alice']);
        expect(await names('@lice')).toEqual([]);
        expect(await names('ОЛЕНА')).toEqual(['olena_cards']);
        expect(await names('o')).toEqual(['olena_cards', 'mod', 'bob']);
        expect(olena.id).toBeGreaterThan(0);
        expect(
            (await routes.sellers(request('/api/admin/sellers', alice))).status
        ).toBe(403);
    });

    test(`a search shows at most ${MAX_SEARCH_RESULTS} lists, or sellers`, async () => {
        for (let i = 0; i < MAX_SEARCH_RESULTS; i++)
            users.login(
                { telegramId: 100 + i, username: `s${i}`, displayName: 'S' },
                0
            );
        const res = await routes.sellers(request('/api/admin/sellers', mod));
        expect(await res.json()).toHaveLength(MAX_SEARCH_RESULTS);
    });

    test(`a search shows at most ${MAX_SEARCH_RESULTS} lists`, async () => {
        for (let i = 0; i < MAX_SEARCH_RESULTS + 1; i++)
            lists.submit(
                alice.id,
                { source: 'mtggoldfish', ref: String(i + 1) },
                i
            );
        const res = await routes.queue(
            request('/api/admin/lists?q=mtggoldfish', mod)
        );
        expect(await res.json()).toHaveLength(MAX_SEARCH_RESULTS);
    });

    test('a review needs a known list and status', async () => {
        const { id } = await add(alice, GOLDFISH);
        expect((await review(id, 'pending')).status).toBe(400);
        expect((await review(999, 'approved')).status).toBe(404);
        expect((await review('x', 'approved')).status).toBe(404);
        expect(
            (await routes.queue(request('/api/admin/lists?status=all', mod)))
                .status
        ).toBe(400);
        expect(due).toEqual([]);
    });

    test('a moderator has approved lists read again now: the ticked ones, or all', async () => {
        const refresh = (body: unknown, user: User | null = mod) =>
            routes.refresh(request('/api/admin/refresh', user, { body }));
        const a = await add(alice, GOLDFISH);
        const b = await add(bob, MANABOX);
        await review(a.id, 'approved');
        await review(b.id, 'approved');
        lists.saveCards(a.id, { cards: [] }, 1000, 5000);
        lists.saveCards(b.id, { cards: [] }, 1000, 5000);
        due.length = 0;
        logs.length = 0;

        let res = await refresh({ ids: [b.id] });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ refreshed: [b.id] });
        expect(due).toEqual([b.id]);
        expect(lists.get(b.id)?.nextFetchAt).toBe(1000);
        // "all" includes b, though it's due already: the refresher reads each list once, whoever asks (ListRefresher)
        res = await refresh({ all: true });
        expect(await res.json()).toEqual({ refreshed: [a.id, b.id] });
        expect(due).toEqual([b.id, a.id, b.id]);
        expect(lists.get(b.id)?.nextFetchAt).toBe(1000); // still first in line
        expect(
            logs.map((l) => [l.message, l.lists, l.all, l.moderator])
        ).toEqual([
            ['lists refresh requested', 1, false, mod.id],
            ['lists refresh requested', 2, true, mod.id]
        ]);
        // no approved lists asked for: the refresher isn't woken
        due.length = 0;
        res = await refresh({ ids: [999] });
        expect(await res.json()).toEqual({ refreshed: [] });
        expect(due).toEqual([]);

        for (const body of [
            {},
            { all: 'yes' },
            { ids: [] },
            { ids: 'all' },
            { ids: ['1'] },
            { ids: [0] },
            { ids: [1.5] }
        ])
            expect((await refresh(body)).status).toBe(400);
        expect((await refresh({ all: true }, alice)).status).toBe(403);
        expect((await refresh({ all: true }, null)).status).toBe(401);
    });

    test('a ban signs the trader out and shows in the queue; it can be lifted', async () => {
        await submit(bob, MANABOX);
        expect((await ban(bob.id, true)).status).toBe(204);
        expect(users.get(bob.id)?.banned).toBe(true);
        expect((await queue())[0]?.owner.banned).toBe(true);
        expect((await submit(bob, GOLDFISH)).status).toBe(401);
        expect(logs.at(-1)).toMatchObject({
            message: 'user banned',
            user: bob.id,
            moderator: mod.id
        });

        expect((await ban(bob.id, false)).status).toBe(204);
        expect(users.get(bob.id)?.banned).toBe(false);
        expect(logs.at(-1)?.message).toBe('user unbanned');
    });

    test("a ban needs a known user who isn't a moderator", async () => {
        expect((await ban(bob.id, 'yes')).status).toBe(400);
        expect((await ban(999, true)).status).toBe(404);
        expect((await ban('x', true)).status).toBe(404);
        expect((await ban(mod.id, true)).status).toBe(400);
        expect(users.get(mod.id)?.banned).toBe(false);
    });
});

test('by default, approving needs no listener and uses the clock', async () => {
    const db = openDatabase(':memory:');
    const users = new UserStore(db);
    const lists = new ListStore(db);
    const mod = users.login({
        telegramId: 1,
        username: 'mod',
        displayName: 'Mod'
    });
    const list = lists.submit(mod.id, { source: 'manabox', ref: 'abc' })!;
    const routes = adminHandlers(lists, users, {
        currentUser: () => mod,
        isAdmin: () => true
    });
    const res = await routes.review(
        new Request(`${BASE}/api/admin/lists/${list.id}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'approved' })
        }),
        String(list.id)
    );
    expect(res.status).toBe(204);
    expect(lists.get(list.id)?.reviewedAt).toBeGreaterThan(Date.now() - 60_000);
});
