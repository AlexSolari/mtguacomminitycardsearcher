import { beforeEach, describe, expect, test } from 'bun:test';
import type { MyList, SubmittedLists } from '@/shared/account';
import { openDatabase } from '@/server/db/database';
import { ListStore } from '@/server/lists/list-store';
import { UserStore, type User } from '@/server/auth/user-store';
import { listsHandlers, MAX_LISTS_PER_USER } from '@/server/lists/lists-route';
import { captureLogs } from '../capture-logs';
import {
    BASE,
    GOLDFISH,
    MANABOX,
    lists,
    alice,
    bob,
    submitted,
    routes,
    request,
    submit,
    add,
    mine,
    queue,
    review,
    goldfish,
    post,
    setUpRoutes
} from './route-fixture';

const logs = captureLogs();

describe('lists routes', () => {
    beforeEach(() => {
        setUpRoutes();
        logs.length = 0; // the migration's log line
    });

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
});

test('by default, submitting needs no listener and uses the clock', async () => {
    const db = openDatabase(':memory:');
    const users = new UserStore(db);
    const lists = new ListStore(db);
    const trader = users.login({
        telegramId: 1,
        username: 'trader',
        displayName: 'Trader'
    });
    const routes = listsHandlers(lists, users, {
        currentUser: () => trader,
        isAdmin: () => false
    });
    const res = await routes.submit(
        new Request(`${BASE}/api/lists`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: GOLDFISH })
        })
    );
    const { added } = (await res.json()) as SubmittedLists;
    expect(added[0]!.createdAt).toBeGreaterThan(Date.now() - 60_000);
});
