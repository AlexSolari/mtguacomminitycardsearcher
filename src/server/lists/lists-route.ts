import type {
    MyList,
    MyLists,
    RateError,
    SubmitListError,
    SubmittedLists
} from '@/shared/account';
import type { ListStore, TraderList } from '@/server/lists/list-store';
import type { User, UserStore } from '@/server/auth/user-store';
import { sessionGuard, type SessionAuth } from '@/server/auth/signed-in';
import { findListLinks, LIST_SOURCES } from '@/server/lists/list-link';
import { logger } from '@/server/observability/logger';
import { error, noContent, noStore, rowId } from '@/server/http/json-route';
import { readJson } from '@/server/http/read-body';

// A trader's own lists (their moderation is in admin-route.ts):
//   GET    /api/lists                    → MyLists
//   POST   /api/lists {text}             → SubmittedLists: every list linked in the text | 400 {error: SubmitListError}
//   DELETE /api/lists/:id                → 204
//   PATCH  /api/lists/:id {usdRate}      → MyList: the list's own exchange rate (null: the owner's default)
//   POST   /api/lists/rate {usdRate}     → 204: the owner's default exchange rate (null: prices stay in USD)
// Everything needs a session. Writes take JSON only: with the session cookie SameSite=Lax, another site can't
// send them with it, and a cross-site JSON POST would need a CORS preflight.

// Lists one trader may have, in any state.
export const MAX_LISTS_PER_USER = 25;
// An exchange rate; anything bigger isn't from our frontend.
const MAX_BODY_BYTES = 2048;
// A trader's message with their links: a Telegram message is at most 4096 characters, a few more once in JSON.
const MAX_MESSAGE_BYTES = 16384;

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

// A trader's list as its owner sees it; a moderator's view (admin-route.ts) adds its owner.
export const myList = (l: TraderList): MyList => ({
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

export function listsHandlers(
    lists: ListStore,
    users: UserStore,
    auth: SessionAuth,
    hooks: {
        // lists a trader just submitted, and how many await review, these included; the moderators are told
        onSubmitted?: (
            user: User,
            lists: TraderList[],
            pending: number
        ) => void;
    } = {},
    now = () => Date.now()
) {
    const signedIn = sessionGuard(auth);
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
            const rate = usdRate(
                (await readJson(req, MAX_BODY_BYTES))?.usdRate
            );
            if (rate === undefined)
                return error('invalid-rate' satisfies RateError, 400);
            users.setUsdRate(user.id, rate);
            logger.info('exchange rate set', { user: user.id, rate });
            return noContent();
        }),

        setListRate: signedIn(async (user, req, id: string) => {
            const listId = rowId(id);
            const rate = usdRate(
                (await readJson(req, MAX_BODY_BYTES))?.usdRate
            );
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
        })
    };
}
