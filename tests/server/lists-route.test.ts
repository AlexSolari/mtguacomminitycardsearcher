import { beforeEach, describe, expect, test } from 'bun:test';
import type {
    ModeratedList,
    ModeratedSeller,
    MyList,
    MyLists,
    SubmittedLists
} from '@/account';
import { openDatabase } from '@/server/db/database';
import { ListStore } from '@/server/db/list-store';
import { UserStore, type User } from '@/server/db/user-store';
import {
    listsHandlers,
    MAX_LISTS_PER_USER,
    MAX_SEARCH_RESULTS
} from '@/server/lists-route';
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
    let due: number[];
    let submitted: { user: number; lists: number[]; pending: number }[];
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
        due = [];
        submitted = [];
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
            {
                onDue: (ids) => due.push(...ids),
                onSubmitted: (user, added, pending) =>
                    submitted.push({
                        user: user.id,
                        lists: added.map((l) => l.id),
                        pending
                    })
            },
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
    const submit = (user: User | null, text: unknown) =>
        routes.submit(request('/api/lists', user, { body: { text } }));
    // a list the user adds by its link
    const add = async (user: User, link: string) =>
        ((await (await submit(user, link)).json()) as SubmittedLists).added[0]!;
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

    const goldfish = (id: number) => `https://www.mtggoldfish.com/deck/${id}`;
    // a trader's post, the way they share their lists in Telegram groups
    const post = (...ids: number[]) =>
        ids
            .map((id) => `🔥 Список №${id}\n${goldfish(id)}#paper🔥`)
            .join('\n\n');

    test('a trader adds a list by its link; it waits for review', async () => {
        const res = await submit(alice, ` ${GOLDFISH} `);
        expect(res.status).toBe(200);
        const body = (await res.json()) as SubmittedLists;
        const list = body.added[0]!;
        expect(body).toEqual({
            added: [
                {
                    id: expect.any(Number),
                    source: 'mtggoldfish',
                    url: 'https://www.mtggoldfish.com/deck/6906342',
                    title: null,
                    status: 'pending',
                    createdAt: 1000,
                    fetchedAt: null,
                    cardCount: 0,
                    lastError: null,
                    usdRate: null
                }
            ],
            skipped: []
        });
        expect(await mine(alice)).toEqual({
            lists: [list],
            max: MAX_LISTS_PER_USER,
            usdRate: null
        });
        expect((await mine(bob)).lists).toEqual([]);
        expect(logs.map((l) => [l.message, l.user, l.source])).toEqual([
            ['list submitted', alice.id, 'mtggoldfish']
        ]);
    });

    test('a post adds every list in it, newest first, and skips the ones already added', async () => {
        await submit(alice, goldfish(2));
        await submit(bob, goldfish(3));
        logs.length = 0;
        const res = await submit(alice, `Продаж, курс 40\n${post(1, 2, 3, 4)}`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as SubmittedLists;
        expect(body.added.map((l) => [l.url, l.status])).toEqual([
            [goldfish(4), 'pending'],
            [goldfish(1), 'pending']
        ]);
        expect(body.skipped).toEqual([
            { url: goldfish(2), reason: 'mine' },
            { url: goldfish(3), reason: 'taken' }
        ]);
        expect((await mine(alice)).lists.map((l) => l.url)).toEqual([
            goldfish(4),
            goldfish(1),
            goldfish(2)
        ]);
        expect(logs.map((l) => [l.message, l.user])).toEqual([
            ['list submitted', alice.id],
            ['list submitted', alice.id]
        ]);
    });

    test('moderators hear about each submission once, with every list it added', async () => {
        await submit(bob, goldfish(3));
        const body = (await (
            await submit(alice, post(1, 2, 3))
        ).json()) as SubmittedLists;
        expect(submitted).toEqual([
            { user: bob.id, lists: [expect.any(Number)], pending: 1 },
            {
                user: alice.id,
                // in the post's order
                lists: body.added.map((l) => l.id).reverse(),
                pending: 3
            }
        ]);

        // nothing new (all already added): no message
        await submit(alice, post(1, 2));
        expect(submitted).toHaveLength(2);
    });

    test(`stops at ${MAX_LISTS_PER_USER} lists, naming the ones left out`, async () => {
        for (let i = 1; i < MAX_LISTS_PER_USER; i++)
            await submit(alice, goldfish(i));
        const ids = [1, 100, 101, 102];
        const body = (await (
            await submit(alice, post(...ids))
        ).json()) as SubmittedLists;
        expect(body.added.map((l) => l.url)).toEqual([goldfish(100)]);
        expect(body.skipped).toEqual([
            { url: goldfish(1), reason: 'mine' },
            { url: goldfish(101), reason: 'too-many' },
            { url: goldfish(102), reason: 'too-many' }
        ]);
        expect((await mine(alice)).lists).toHaveLength(MAX_LISTS_PER_USER);
    });

    test('a post without list links, or no text, is refused', async () => {
        for (const text of [
            'Продам карти, пишіть',
            'https://example.com/deck/1',
            42,
            undefined
        ]) {
            const res = await submit(alice, text);
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({ error: 'no-links' });
        }
        expect((await mine(alice)).lists).toEqual([]);
    });

    test('only JSON bodies of a sane size are read', async () => {
        const send = (body: string, type?: string) =>
            routes.submit(request('/api/lists', alice, { body, type }));
        expect(
            (await send(JSON.stringify({ text: GOLDFISH }), 'text/plain'))
                .status
        ).toBe(400);
        expect((await send('{')).status).toBe(400);
        expect((await send(JSON.stringify([GOLDFISH]))).status).toBe(400);
        // a Telegram-sized post, but not much more
        expect(
            (
                await send(
                    JSON.stringify({ text: `${'💥'.repeat(2000)} ${GOLDFISH}` })
                )
            ).status
        ).toBe(200);
        expect(
            (
                await send(
                    JSON.stringify({ text: `${'x'.repeat(20000)} ${MANABOX}` })
                )
            ).status
        ).toBe(400);
    });

    test('a trader sets a default exchange rate, and one per list over it', async () => {
        const setRate = (usdRate: unknown, user: User | null = alice) =>
            routes.setRate(
                request('/api/lists/rate', user, { body: { usdRate } })
            );
        const setListRate = (
            id: number | string,
            usdRate: unknown,
            user: User = alice
        ) =>
            routes.setListRate(
                request(`/api/lists/${id}`, user, {
                    method: 'PATCH',
                    body: { usdRate }
                }),
                String(id)
            );
        const list = await add(alice, GOLDFISH);
        logs.length = 0;

        expect((await setRate(42.456)).status).toBe(204);
        expect((await mine(alice)).usdRate).toBe(42.46);
        const res = await setListRate(list.id, 44);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ...list, usdRate: 44 });
        expect((await mine(alice)).lists[0]?.usdRate).toBe(44);
        expect(
            ((await (await setListRate(list.id, null)).json()) as MyList)
                .usdRate
        ).toBeNull();
        expect((await setRate(null)).status).toBe(204);
        expect((await mine(alice)).usdRate).toBeNull();
        expect(logs.map((l) => [l.message, l.list, l.rate])).toEqual([
            ['exchange rate set', undefined, 42.46],
            ['exchange rate set', list.id, 44],
            ['exchange rate set', list.id, null],
            ['exchange rate set', undefined, null]
        ]);

        for (const bad of [0, 0.5, 1001, '42', true, undefined, {}]) {
            const r = await setRate(bad);
            expect(r.status).toBe(400);
            expect(await r.json()).toEqual({ error: 'invalid-rate' });
            expect((await setListRate(list.id, bad)).status).toBe(400);
        }
        expect((await setRate(1)).status).toBe(204);
        expect((await setRate(1000)).status).toBe(204);
        // someone else's list, or none
        expect((await setListRate(list.id, 40, bob)).status).toBe(404);
        expect((await setListRate(999, 40)).status).toBe(404);
        expect((await setListRate('x', 40)).status).toBe(404);
        expect((await setRate(40, null)).status).toBe(401);

        // an approved list's rate changes without another review, and moderators see both rates
        await review(list.id, 'approved');
        await setRate(41);
        await setListRate(list.id, 43);
        const [moderated] = await queue('approved');
        expect(moderated).toMatchObject({
            id: list.id,
            status: 'approved',
            usdRate: 43,
            owner: { usdRate: 41 }
        });
    });

    test('a trader deletes their own lists only', async () => {
        const { id } = await add(alice, GOLDFISH);
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
