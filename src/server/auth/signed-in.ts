import type { User } from '@/server/auth/user-store';
import { error } from '@/server/http/json-route';

// What the signed-in routes need of the session (authHandlers gives both).
export type SessionAuth = {
    currentUser: (req: Request) => User | null;
    isAdmin: (user: User) => boolean;
};

// Wraps a route: it runs `handle` for the signed-in user (a moderator, with `admin`), or answers 401/403.
export function sessionGuard(auth: SessionAuth) {
    return <A extends unknown[]>(
            handle: (
                user: User,
                req: Request,
                ...args: A
            ) => Response | Promise<Response>,
            admin = false
        ) =>
        async (req: Request, ...args: A): Promise<Response> => {
            const user = auth.currentUser(req);
            if (!user) return error('Not signed in', 401);
            if (admin && !auth.isAdmin(user)) return error('Not allowed', 403);
            return handle(user, req, ...args);
        };
}
