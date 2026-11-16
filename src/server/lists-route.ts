import type {
    ListStatus,
    ModeratedList,
    MyList,
    MyLists,
    SubmitListError
} from '../account';
import type { ListStore, ReviewedList, TraderList } from './db/list-store';
import type { User, UserStore } from './db/user-store';
import { LIST_SOURCES, parseListLink } from './lists/list-link';
import { logger } from './logger';

// Traders' lists and their moderation:
//   GET    /api/lists                    → MyLists
//   POST   /api/lists {link}             → 201 MyList | 400/403/409 {error: SubmitListError}
//   DELETE /api/lists/:id                → 204
//   GET    /api/admin/lists?status=…     → ModeratedList[] (pending by default)
//   POST   /api/admin/lists/:id {status} → 204; approving reads the list at once (`onApproved`)
//   POST   /api/admin/users/:id {banned} → 204
// Everything needs a session; the admin routes need a moderator's. Writes take JSON only: with the session cookie
// SameSite=Lax, another site can't send them with it, and a cross-site JSON POST would need a CORS preflight.

// Lists one trader may have, in any state.
export const MAX_LISTS_PER_USER = 10;
// A link, or a moderator's decision; anything bigger isn't from our frontend.
const MAX_BODY_BYTES = 2048;

const STATUSES = new Set<ListStatus>(['pending', 'approved', 'rejected']);

const error = (message: string, status: number) =>
    Response.json({ error: message }, { status });
const noContent = () => new Response(null, { status: 204 });
const noStore = { 'Cache-Control': 'no-store' };

// The request's JSON object, or null when it isn't one (or isn't sent as JSON).
async function readJson(req: Request): Promise<Record<string, unknown> | null> {
    if (!req.headers.get('content-type')?.startsWith('application/json'))
        return null;
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return null;
    try {
        const body = JSON.parse(text);
        return typeof body === 'object' && body !== null && !Array.isArray(body)
            ? body
            : null;
    } catch {
        return null;
    }
}

// A route's `:id`, when it's one a row could have.
const rowId = (id: string) => {
    const n = Number(id);
    return /^\d{1,15}$/.test(id) && n > 0 ? n : null;
};

const myList = (l: TraderList): MyList => ({
    id: l.id,
    source: l.source,
    url: LIST_SOURCES[l.source].link(l.ref),
    title: l.title,
    status: l.status,
    createdAt: l.createdAt,
    fetchedAt: l.fetchedAt,
    cardCount: l.cardCount,
    lastError: l.lastError
});

const moderatedList = (l: ReviewedList): ModeratedList => ({
    ...myList(l),
    reviewedAt: l.reviewedAt,
    owner: {
        id: l.userId,
        username: l.username,
        displayName: l.displayName,
        banned: l.banned
    }
});

export function listsHandlers(
    lists: ListStore,
    users: UserStore,
    auth: {
        currentUser: (req: Request) => User | null;
        isAdmin: (user: User) => boolean;
    },
    onApproved: (listId: number) => void = () => {},
    now = () => Date.now()
) {
    // Runs `handle` for the signed-in user (a moderator, with `admin`), or answers 401/403.
    const signedIn =
        <A extends unknown[]>(
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

    return {
        mine: signedIn((user) => {
            const body: MyLists = {
                lists: lists.ofUser(user.id).map(myList),
                max: MAX_LISTS_PER_USER
            };
            return Response.json(body, { headers: noStore });
        }),

        submit: signedIn(async (user, req) => {
            const body = await readJson(req);
            const link =
                typeof body?.link === 'string'
                    ? parseListLink(body.link)
                    : null;
            if (!link)
                return error('invalid-link' satisfies SubmitListError, 400);
            if (lists.ofUser(user.id).length >= MAX_LISTS_PER_USER)
                return error('too-many' satisfies SubmitListError, 403);
            const list = lists.submit(user.id, link, now());
            if (!list) return error('taken' satisfies SubmitListError, 409);
            logger.info('list submitted', {
                user: user.id,
                list: list.id,
                source: list.source
            });
            return Response.json(myList(list), { status: 201 });
        }),

        remove: signedIn((user, _req, id: string) => {
            const listId = rowId(id);
            if (!listId || !lists.remove(listId, user.id))
                return error('Not found', 404);
            logger.info('list deleted', { user: user.id, list: listId });
            return noContent();
        }),

        queue: signedIn((_user, req) => {
            const status =
                new URL(req.url).searchParams.get('status') ?? 'pending';
            if (!STATUSES.has(status as ListStatus))
                return error('Unknown status', 400);
            const body: ModeratedList[] = lists
                .withStatus(status as ListStatus)
                .map(moderatedList);
            return Response.json(body, { headers: noStore });
        }, true),

        review: signedIn(async (user, req, id: string) => {
            const listId = rowId(id);
            const status = (await readJson(req))?.status;
            if (status !== 'approved' && status !== 'rejected')
                return error('Unknown status', 400);
            if (!listId || !lists.review(listId, status, now()))
                return error('Not found', 404);
            logger.info('list reviewed', {
                list: listId,
                status,
                moderator: user.id
            });
            if (status === 'approved') onApproved(listId);
            return noContent();
        }, true),

        ban: signedIn(async (user, req, id: string) => {
            const userId = rowId(id);
            const banned = (await readJson(req))?.banned;
            if (typeof banned !== 'boolean') return error('Bad request', 400);
            const target = userId ? users.get(userId) : null;
            if (!target) return error('Not found', 404);
            // a moderator can't lock themselves or another moderator out
            if (auth.isAdmin(target))
                return error('Moderators cannot be banned', 400);
            users.setBanned(target.id, banned);
            logger.info(banned ? 'user banned' : 'user unbanned', {
                user: target.id,
                moderator: user.id
            });
            return noContent();
        }, true)
    };
}
