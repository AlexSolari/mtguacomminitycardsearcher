// Shared by the lists and admin route tests. setUpRoutes (call it in a beforeEach) opens a fresh database with
// three users, alice, bob and a moderator, and both route sets over it; requests are signed in as whoever a test
// says. setUpRoutes reassigns the bindings below, and importers always see the current ones.
import type { ModeratedList, MyLists, SubmittedLists } from '@/shared/account';
import { openDatabase } from '@/server/db/database';
import { ListStore } from '@/server/lists/list-store';
import { UserStore, type User } from '@/server/auth/user-store';
import type { SessionAuth } from '@/server/auth/signed-in';
import { listsHandlers } from '@/server/lists/lists-route';
import { adminHandlers } from '@/server/lists/admin-route';

export const BASE = 'https://cards.example';
export const GOLDFISH = 'https://www.mtggoldfish.com/deck/6906342#paper';
export const MANABOX = 'https://manabox.app/decks/Qsjv6XwMQ_SynKoo3V-epw';

export let users: UserStore;
export let lists: ListStore;
export let alice: User;
export let bob: User;
export let mod: User;
// what the routes passed to their hooks: lists due for reading, and submissions the moderators are told of
export let due: number[];
export let submitted: { user: number; lists: number[]; pending: number }[];
export let routes: ReturnType<typeof listsHandlers> &
    ReturnType<typeof adminHandlers>;

export function setUpRoutes() {
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
    const auth: SessionAuth = {
        currentUser: (req) => {
            const user = users.get(Number(req.headers.get('x-user')));
            return user && !user.banned ? user : null;
        },
        isAdmin: (user) => user.telegramId === mod.telegramId
    };
    routes = {
        ...listsHandlers(
            lists,
            users,
            auth,
            {
                onSubmitted: (user, added, pending) =>
                    submitted.push({
                        user: user.id,
                        lists: added.map((l) => l.id),
                        pending
                    })
            },
            () => 1000
        ),
        ...adminHandlers(
            lists,
            users,
            auth,
            { onDue: (ids) => due.push(...ids) },
            () => 1000
        )
    };
}

export const request = (
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
export const submit = (user: User | null, text: unknown) =>
    routes.submit(request('/api/lists', user, { body: { text } }));
// a list the user adds by its link
export const add = async (user: User, link: string) =>
    ((await (await submit(user, link)).json()) as SubmittedLists).added[0]!;
export const mine = async (user: User) =>
    (await (await routes.mine(request('/api/lists', user))).json()) as MyLists;
export const queue = async (status?: string) =>
    (await (
        await routes.queue(
            request(`/api/admin/lists${status ? `?status=${status}` : ''}`, mod)
        )
    ).json()) as ModeratedList[];
export const review = (id: number | string, status: unknown, user = mod) =>
    routes.review(
        request(`/api/admin/lists/${id}`, user, { body: { status } }),
        String(id)
    );
export const ban = (id: number | string, banned: unknown, user = mod) =>
    routes.ban(
        request(`/api/admin/users/${id}`, user, { body: { banned } }),
        String(id)
    );

export const goldfish = (id: number) =>
    `https://www.mtggoldfish.com/deck/${id}`;
// a trader's post, the way they share their lists in Telegram groups
export const post = (...ids: number[]) =>
    ids.map((id) => `🔥 Список №${id}\n${goldfish(id)}#paper🔥`).join('\n\n');
