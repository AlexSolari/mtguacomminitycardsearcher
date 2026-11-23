import type {
    ListStatus,
    ModeratedList,
    ModeratedSeller
} from '@/shared/account';
import type { ListStore, ReviewedList } from '@/server/lists/list-store';
import type { SellerRow, User, UserStore } from '@/server/auth/user-store';
import { sessionGuard, type SessionAuth } from '@/server/auth/signed-in';
import { LIST_SOURCES, parseListLink } from '@/server/lists/list-link';
import { myList } from '@/server/lists/lists-route';
import { logger } from '@/server/observability/logger';
import { error, noContent, noStore, rowId } from '@/server/http/json-route';
import { readJson } from '@/server/http/read-body';

// Moderation of traders' lists and of the traders themselves:
//   GET    /api/admin/lists?status=…     → ModeratedList[] (pending by default)
//   GET    /api/admin/lists?q=…          → ModeratedList[]: lists in any state, by seller, title or link
//   GET    /api/admin/sellers?q=…        → ModeratedSeller[]: every seller, or those matching by name or @username
//   POST   /api/admin/lists/:id {status} → 204; approving reads the list at once (`onDue`)
//   POST   /api/admin/refresh {ids}|{all: true} → {refreshed: number[]}: approved lists read again now (`onDue`)
//   POST   /api/admin/users/:id {banned} → 204
// All need a moderator's session. Writes take JSON only, as in lists-route.ts.

// A moderator's decision; anything bigger isn't from our frontend.
const MAX_BODY_BYTES = 2048;

const STATUSES = new Set<ListStatus>(['pending', 'approved', 'rejected']);

// A moderator's search: at most this many lists (newest first) or sellers (most recently signed in first).
export const MAX_SEARCH_RESULTS = 50;
// Longer than any username, title or link; anything longer is cut.
const MAX_QUERY = 200;

const lower = (text: string) => text.toLocaleLowerCase('uk');

// "@name" is the start of a seller's username (what "Показати списки" sends); anything else, a piece of their
// username or Telegram name. Ignoring case, Cyrillic too, which SQLite's LIKE wouldn't.
function sellerMatcher(query: string) {
    if (query.startsWith('@')) {
        const start = lower(query.slice(1));
        return (s: { username: string }) => lower(s.username).startsWith(start);
    }
    const needle = lower(query);
    return (s: { username: string; displayName: string }) =>
        [s.username, s.displayName].some((f) => lower(f).includes(needle));
}

// Whether a list matches a moderator's search: a pasted link finds its list however it's spelled
// (parseListLink); "@name" finds the seller's lists; anything else is a piece of the seller's username or name,
// the list's title or its link.
function listMatcher(query: string) {
    const link = parseListLink(query);
    if (link)
        return (l: ReviewedList) =>
            l.source === link.source && l.ref === link.ref;
    const seller = sellerMatcher(query);
    if (query.startsWith('@')) return seller;
    const needle = lower(query);
    return (l: ReviewedList) =>
        seller(l) ||
        [l.title, LIST_SOURCES[l.source].link(l.ref)].some(
            (f) => f !== null && lower(f).includes(needle)
        );
}

const moderatedSeller = (
    s: SellerRow,
    isAdmin: (user: User) => boolean
): ModeratedSeller => ({
    id: s.id,
    username: s.username,
    displayName: s.displayName,
    banned: s.banned,
    admin: isAdmin(s),
    usdRate: s.usdRate,
    createdAt: s.createdAt,
    lastLoginAt: s.lastLoginAt,
    lists: { pending: s.pending, approved: s.approved, rejected: s.rejected }
});

const moderatedList = (l: ReviewedList): ModeratedList => ({
    ...myList(l),
    reviewedAt: l.reviewedAt,
    owner: {
        id: l.userId,
        username: l.username,
        displayName: l.displayName,
        banned: l.banned,
        usdRate: l.ownerUsdRate
    }
});

export function adminHandlers(
    lists: ListStore,
    users: UserStore,
    auth: SessionAuth,
    hooks: {
        // lists that just became due (approved, or refreshed by a moderator); the refresher reads them at once
        onDue?: (listIds: number[]) => void;
    } = {},
    now = () => Date.now()
) {
    const signedIn = sessionGuard(auth);
    const onDue = hooks.onDue ?? (() => {});

    return {
        queue: signedIn((_user, req) => {
            const params = new URL(req.url).searchParams;
            const query = params.get('q')?.trim().slice(0, MAX_QUERY);
            if (query) {
                const body: ModeratedList[] = lists
                    .withStatus()
                    .filter(listMatcher(query))
                    .slice(0, MAX_SEARCH_RESULTS)
                    .map(moderatedList);
                return Response.json(body, { headers: noStore });
            }
            const status = params.get('status') ?? 'pending';
            if (!STATUSES.has(status as ListStatus))
                return error('Unknown status', 400);
            const body: ModeratedList[] = lists
                .withStatus(status as ListStatus)
                .map(moderatedList);
            return Response.json(body, { headers: noStore });
        }, true),

        review: signedIn(async (user, req, id: string) => {
            const listId = rowId(id);
            const status = (await readJson(req, MAX_BODY_BYTES))?.status;
            if (status !== 'approved' && status !== 'rejected')
                return error('Unknown status', 400);
            if (!listId || !lists.review(listId, status, now()))
                return error('Not found', 404);
            logger.info('list reviewed', {
                list: listId,
                status,
                moderator: user.id
            });
            if (status === 'approved') onDue([listId]);
            return noContent();
        }, true),

        refresh: signedIn(async (user, req) => {
            const body = await readJson(req, MAX_BODY_BYTES);
            const ids = body?.ids;
            const which =
                body?.all === true
                    ? 'all'
                    : Array.isArray(ids) &&
                        ids.length > 0 &&
                        ids.every((id) => rowId(String(id)) === id)
                      ? (ids as number[])
                      : null;
            if (!which) return error('Bad request', 400);
            const refreshed = lists.refreshNow(which, now());
            logger.info('lists refresh requested', {
                lists: refreshed.length,
                all: which === 'all',
                moderator: user.id
            });
            if (refreshed.length > 0) onDue(refreshed);
            return Response.json({ refreshed });
        }, true),

        sellers: signedIn((_user, req) => {
            const query = new URL(req.url).searchParams
                .get('q')
                ?.trim()
                .slice(0, MAX_QUERY);
            const body: ModeratedSeller[] = users
                .sellers()
                .filter(query ? sellerMatcher(query) : () => true)
                .slice(0, MAX_SEARCH_RESULTS)
                .map((s) => moderatedSeller(s, auth.isAdmin));
            return Response.json(body, { headers: noStore });
        }, true),

        ban: signedIn(async (user, req, id: string) => {
            const userId = rowId(id);
            const banned = (await readJson(req, MAX_BODY_BYTES))?.banned;
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
