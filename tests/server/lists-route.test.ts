import { beforeEach, describe, expect, test } from 'bun:test';
import type { ModeratedList, MyList, MyLists } from '@/account';
import { openDatabase } from '@/server/db/database';
import { ListStore } from '@/server/db/list-store';
import { UserStore, type User } from '@/server/db/user-store';
import { listsHandlers, MAX_LISTS_PER_USER } from '@/server/lists-route';
import { captureLogs } from './capture-logs';

const logs = captureLogs();
const BASE = 'https://cards.example';
const GOLDFISH = 'https://www.mtggoldfish.com/deck/6906342#paper';
const MANABOX = 'https://manabox.app/decks/Qsjv6XwMQ_SynKoo3V-epw';

describe('lists routes', () => {
    let users: UserStore;
    let lists: ListStore;
    let alice: User;
    let bob: User;
    let mod: User;
    let approved: number[];
    let routes: ReturnType<typeof listsHandlers>;
    beforeEach(() => {
        const db = openDatabase(':memory:');
        users = new UserStore(db);
        lists = new ListStore(db);
        const login = (telegramId: number, username: string) =>
            users.login(
                { telegramId, username, displayName: username.toUpperCase() },
                0
            );
        alice = login(1, 'alice');
        bob = login(2, 'bob');
        mod = login(3, 'mod');
        approved = [];
        // the signed-in user is whoever the test says (x-user), unless they're banned
        routes = listsHandlers(
            lists,
            users,
            {
                currentUser: (req) => {
                    const user = users.get(Number(req.headers.get('x-user')));
                    return user && !user.banned ? user : null;
                },
                isAdmin: (user) => user.telegramId === mod.telegramId
            },
            (id) => approved.push(id),
            () => 1000
        );
        logs.length = 0; // the migration's log line
    });

    const request = (
        path: string,
        user: User | null,
        init: { method?: string; body?: unknown; type?: string } = {}
    ) =>
        new Request(new URL(path, BASE), {
            method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
            headers: {
                ...(user && { 'x-user': String(user.id) }),
                ...(init.body !== undefined && {
                    'content-type': init.type ?? 'application/json'
                })
            },
            body:
                init.body === undefined
                    ? undefined
                    : typeof init.body === 'string'
                      ? init.body
                      : JSON.stringify(init.body)
        });
    const submit = (user: User | null, link: unknown) =>
        routes.submit(request('/api/lists', user, { body: { link } }));
    const mine = async (user: User) =>
        (await (
            await routes.mine(request('/api/lists', user))
        ).json()) as MyLists;
    const queue = async (status?: string) =>
        (await (
            await routes.queue(
                request(
                    `/api/admin/lists${status ? `?status=${status}` : ''}`,
                    mod
                )
            )
        ).json()) as ModeratedList[];
    const review = (id: number | string, status: unknown, user = mod) =>
        routes.review(
            request(`/api/admin/lists/${id}`, user, { body: { status } }),
            String(id)
        );
    const ban = (id: number | string, banned: unknown, user = mod) =>
        routes.ban(
            request(`/api/admin/users/${id}`, user, { body: { banned } }),
            String(id)
        );

    test('a trader adds a list by its link; it waits for review', async () => {
        const res = await submit(alice, ` ${GOLDFISH} `);
        expect(res.status).toBe(201);
        const list = (await res.json()) as MyList;
        expect(list).toEqual({
            id: expect.any(Number),
            source: 'mtggoldfish',
            url: 'https://www.mtggoldfish.com/deck/6906342',
            title: null,
            status: 'pending',
            createdAt: 1000,
            fetchedAt: null,
            cardCount: 0,
            lastError: null
        });
        expect(await mine(alice)).toEqual({
            lists: [list],
            max: MAX_LISTS_PER_USER
        });
        expect((await mine(bob)).lists).toEqual([]);
        expect(logs.map((l) => [l.message, l.user, l.source])).toEqual([
            ['list submitted', alice.id, 'mtggoldfish']
        ]);
    });

    test("a link that isn't an MTGGoldfish or ManaBox list is refused", async () => {
        for (const link of ['https://example.com/deck/1', 'not a url', 42]) {
            const res = await submit(alice, link);
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({ error: 'invalid-link' });
        }
    });

    test('a list belongs to whoever added it first', async () => {
        await submit(alice, MANABOX);
        for (const user of [alice, bob]) {
            const res = await submit(user, `${MANABOX}/`);
            expect(res.status).toBe(409);
            expect(await res.json()).toEqual({ error: 'taken' });
        }
    });

    test(`a trader may have ${MAX_LISTS_PER_USER} lists`, async () => {
        for (let i = 1; i <= MAX_LISTS_PER_USER; i++)
            expect(
                (await submit(alice, `https://www.mtggoldfish.com/deck/${i}`))
                    .status
            ).toBe(201);
        const res = await submit(alice, GOLDFISH);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'too-many' });
    });

    test('only JSON bodies of a sane size are read', async () => {
        const send = (body: string, type?: string) =>
            routes.submit(request('/api/lists', alice, { body, type }));
        expect(
            (await send(JSON.stringify({ link: GOLDFISH }), 'text/plain'))
                .status
        ).toBe(400);
        expect((await send('{')).status).toBe(400);
        expect((await send(JSON.stringify([GOLDFISH]))).status).toBe(400);
        expect(
            (
                await send(
                    JSON.stringify({ link: GOLDFISH, pad: 'x'.repeat(3000) })
                )
            ).status
        ).toBe(400);
        expect((await send(JSON.stringify({ link: GOLDFISH }))).status).toBe(
            201
        );
    });

    test('a trader deletes their own lists only', async () => {
        const { id } = (await (await submit(alice, GOLDFISH)).json()) as MyList;
        const remove = (user: User, listId: string) =>
            routes.remove(
                request(`/api/lists/${listId}`, user, { method: 'DELETE' }),
                listId
            );
        expect((await remove(bob, String(id))).status).toBe(404);
        expect((await remove(alice, 'abc')).status).toBe(404);
        expect((await remove(alice, '0')).status).toBe(404);
        expect((await remove(alice, String(id))).status).toBe(204);
        expect((await mine(alice)).lists).toEqual([]);
        expect(logs.at(-1)).toMatchObject({
            message: 'list deleted',
            user: alice.id,
            list: id
        });
    });

    test('everything needs a session', async () => {
        expect((await routes.mine(request('/api/lists', null))).status).toBe(
            401
        );
        expect((await submit(null, GOLDFISH)).status).toBe(401);
        expect(
            (
                await routes.remove(
                    request('/api/lists/1', null, { method: 'DELETE' }),
                    '1'
                )
            ).status
        ).toBe(401);
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
        const a = (await (await submit(alice, GOLDFISH)).json()) as MyList;
        const b = (await (await submit(bob, MANABOX)).json()) as MyList;
        expect(await queue()).toEqual([
            {
                ...a,
                reviewedAt: null,
                owner: {
                    id: alice.id,
                    username: 'alice',
                    displayName: 'ALICE',
                    banned: false
                }
            },
            {
                ...b,
                reviewedAt: null,
                owner: {
                    id: bob.id,
                    username: 'bob',
                    displayName: 'BOB',
                    banned: false
                }
            }
        ]);

        logs.length = 0;
        expect((await review(a.id, 'approved')).status).toBe(204);
        expect((await review(b.id, 'rejected')).status).toBe(204);
        expect(approved).toEqual([a.id]);
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

    test('a review needs a known list and status', async () => {
        const { id } = (await (await submit(alice, GOLDFISH)).json()) as MyList;
        expect((await review(id, 'pending')).status).toBe(400);
        expect((await review(999, 'approved')).status).toBe(404);
        expect((await review('x', 'approved')).status).toBe(404);
        expect(
            (await routes.queue(request('/api/admin/lists?status=all', mod)))
                .status
        ).toBe(400);
        expect(approved).toEqual([]);
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
    const routes = listsHandlers(lists, users, {
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
