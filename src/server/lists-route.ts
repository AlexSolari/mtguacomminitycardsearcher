import type {
    ListStatus,
    ModeratedList,
    ModeratedSeller,
    MyList,
    MyLists,
    RateError,
    SubmitListError,
    SubmittedLists
} from '../account';
import type { ListStore, ReviewedList, TraderList } from './db/list-store';
import type { SellerRow, User, UserStore } from './db/user-store';
import { findListLinks, LIST_SOURCES, parseListLink } from './lists/list-link';
import { logger } from './logger';

// Traders' lists and their moderation:
//   GET    /api/lists                    → MyLists
//   POST   /api/lists {text}             → SubmittedLists: every list linked in the text | 400 {error: SubmitListError}
//   DELETE /api/lists/:id                → 204
//   PATCH  /api/lists/:id {usdRate}      → MyList: the list's own exchange rate (null: the owner's default)
//   POST   /api/lists/rate {usdRate}     → 204: the owner's default exchange rate (null: prices stay in USD)
//   GET    /api/admin/lists?status=…     → ModeratedList[] (pending by default)
//   GET    /api/admin/lists?q=…          → ModeratedList[]: lists in any state, by seller, title or link
//   GET    /api/admin/sellers?q=…        → ModeratedSeller[]: every seller, or those matching by name or @username
//   POST   /api/admin/lists/:id {status} → 204; approving reads the list at once (`onDue`)
//   POST   /api/admin/refresh {ids}|{all: true} → {refreshed: number[]}: approved lists read again now (`onDue`)
//   POST   /api/admin/users/:id {banned} → 204
// Everything needs a session; the admin routes need a moderator's. Writes take JSON only: with the session cookie
// SameSite=Lax, another site can't send them with it, and a cross-site JSON POST would need a CORS preflight.

// Lists one trader may have, in any state.
export const MAX_LISTS_PER_USER = 25;
// An exchange rate, or a moderator's decision; anything bigger isn't from our frontend.
const MAX_BODY_BYTES = 2048;
// A trader's message with their links: a Telegram message is at most 4096 characters, a few more once in JSON.
const MAX_MESSAGE_BYTES = 16384;

const STATUSES = new Set<ListStatus>(['pending', 'approved', 'rejected']);

const error = (message: string, status: number) =>
    Response.json({ error: message }, { status });
const noContent = () => new Response(null, { status: 204 });
const noStore = { 'Cache-Control': 'no-store' };

// The request's JSON object, or null when it isn't one (or isn't sent as JSON).
async function readJson(
    req: Request,
    maxBytes = MAX_BODY_BYTES
): Promise<Record<string, unknown> | null> {
    if (!req.headers.get('content-type')?.startsWith('application/json'))
        return null;
    const text = await req.text();
    if (text.length > maxBytes) return null;
    try {
        const body = JSON.parse(text);
        return typeof body === 'object' && body !== null && !Array.isArray(body)
            ? body
            : null;
    } catch {
        return null;
    }
}

// An exchange rate as sent: UAH per USD, to the kopiyka, or null for none. The bounds catch typos (4.3, 4300);
// the hryvnia has been between 8 and 45 to the dollar since 2014.
export const MIN_USD_RATE = 1;
export const MAX_USD_RATE = 1000;
function usdRate(value: unknown): number | null | undefined {
    if (value === null) return null;
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < MIN_USD_RATE ||
        value > MAX_USD_RATE
    )
        return undefined;
    return Math.round(value * 100) / 100;
}

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
    lastError: l.lastError,
    usdRate: l.usdRate
});

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

export function listsHandlers(
    lists: ListStore,
    users: UserStore,
    auth: {
        currentUser: (req: Request) => User | null;
        isAdmin: (user: User) => boolean;
    },
    hooks: {
        // lists that just became due (approved, or refreshed by a moderator); the refresher reads them at once
        onDue?: (listIds: number[]) => void;
        // lists a trader just submitted, and how many await review, these included; the moderators are told
        onSubmitted?: (
            user: User,
            lists: TraderList[],
            pending: number
        ) => void;
    } = {},
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

    const onDue = hooks.onDue ?? (() => {});

    return {
        mine: signedIn((user) => {
            const body: MyLists = {
                lists: lists.ofUser(user.id).map(myList),
                max: MAX_LISTS_PER_USER,
                usdRate: users.usdRate(user.id)
            };
            return Response.json(body, { headers: noStore });
        }),

        // Every list linked in a pasted message, up to the user's limit. Lists the user has already are skipped
        // as theirs, so pasting an updated post again adds only its new links.
        submit: signedIn(async (user, req) => {
            const body = await readJson(req, MAX_MESSAGE_BYTES);
            const links =
                typeof body?.text === 'string' ? findListLinks(body.text) : [];
            if (links.length === 0)
                return error('no-links' satisfies SubmitListError, 400);
            const own = lists.ofUser(user.id);
            const mine = new Set(own.map((l) => `${l.source}/${l.ref}`));
            let room = MAX_LISTS_PER_USER - own.length;
            const result: SubmittedLists = { added: [], skipped: [] };
            const added: TraderList[] = [];
            for (const link of links) {
                const url = LIST_SOURCES[link.source].link(link.ref);
                if (mine.has(`${link.source}/${link.ref}`)) {
                    result.skipped.push({ url, reason: 'mine' });
                    continue;
                }
                if (room <= 0) {
                    result.skipped.push({ url, reason: 'too-many' });
                    continue;
                }
                const list = lists.submit(user.id, link, now());
                if (!list) {
                    result.skipped.push({ url, reason: 'taken' });
                    continue;
                }
                room--;
                logger.info('list submitted', {
                    user: user.id,
                    list: list.id,
                    source: list.source
                });
                added.push(list);
                result.added.unshift(myList(list));
            }
            if (added.length > 0)
                hooks.onSubmitted?.(
                    user,
                    added,
                    lists.withStatus('pending').length
                );
            return Response.json(result);
        }),

        remove: signedIn((user, _req, id: string) => {
            const listId = rowId(id);
            if (!listId || !lists.remove(listId, user.id))
                return error('Not found', 404);
            logger.info('list deleted', { user: user.id, list: listId });
            return noContent();
        }),

        setRate: signedIn(async (user, req) => {
            const rate = usdRate((await readJson(req))?.usdRate);
            if (rate === undefined)
                return error('invalid-rate' satisfies RateError, 400);
            users.setUsdRate(user.id, rate);
            logger.info('exchange rate set', { user: user.id, rate });
            return noContent();
        }),

        setListRate: signedIn(async (user, req, id: string) => {
            const listId = rowId(id);
            const rate = usdRate((await readJson(req))?.usdRate);
            if (rate === undefined)
                return error('invalid-rate' satisfies RateError, 400);
            if (!listId || !lists.setUsdRate(listId, user.id, rate))
                return error('Not found', 404);
            logger.info('exchange rate set', {
                user: user.id,
                list: listId,
                rate
            });
            return Response.json(myList(lists.get(listId)!));
        }),

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
            if (status === 'approved') onDue([listId]);
            return noContent();
        }, true),

        refresh: signedIn(async (user, req) => {
            const body = await readJson(req);
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
