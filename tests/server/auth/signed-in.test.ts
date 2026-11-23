import { expect, test } from 'bun:test';
import { sessionGuard } from '@/server/auth/signed-in';
import type { User } from '@/server/auth/user-store';

const alice = { id: 1, telegramId: 1 } as User;
const mod = { id: 2, telegramId: 2 } as User;

test('a route runs for the signed-in user, an admin route only for a moderator', async () => {
    let user: User | null = null;
    const signedIn = sessionGuard({
        currentUser: () => user,
        isAdmin: (u) => u === mod
    });
    const route = signedIn((u, _req, id: string) =>
        Response.json({ user: u.id, id })
    );
    const adminRoute = signedIn(() => new Response('ok'), true);
    const req = new Request('http://localhost/');

    expect((await route(req, '7')).status).toBe(401);
    expect((await adminRoute(req)).status).toBe(401);

    user = alice;
    expect(await (await route(req, '7')).json()).toEqual({ user: 1, id: '7' });
    expect((await adminRoute(req)).status).toBe(403);

    user = mod;
    expect((await adminRoute(req)).status).toBe(200);
});
