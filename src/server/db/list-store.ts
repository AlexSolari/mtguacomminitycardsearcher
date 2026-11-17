import type { Database } from 'bun:sqlite';
import type { ListRefreshError, ListStatus } from '../../account';
import { normalize } from '../../matching';
import type { Finish, ListCard, ParsedList } from '../lists/list-card';
import type { ListLink, ListSource } from '../lists/list-link';

export type { ListStatus };

export type TraderList = {
    id: number;
    userId: number;
    source: ListSource;
    ref: string;
    title: string | null;
    status: ListStatus;
    createdAt: number;
    reviewedAt: number | null;
    editedAt: number | null;
    fetchedAt: number | null;
    nextFetchAt: number | null;
    lastError: ListRefreshError | null;
    failures: number;
    cardCount: number;
    usdRate: number | null; // UAH per USD for this list, over its owner's (UserStore.usdRate)
};

// A list as moderators see it: with its owner.
export type ReviewedList = TraderList & {
    username: string;
    displayName: string;
    banned: boolean;
    ownerUsdRate: number | null; // the owner's default exchange rate (UserStore.usdRate)
};

// A card as the refresh stores it: the list's row, with the price it settled on.
export type StoredCard = ListCard & {
    approxPrice?: boolean; // the price is for the card or its set, not necessarily the seller's printing
};

// One row of an approved list, with what the search shows about its list and seller.
export type ListOffer = {
    listId: number;
    source: ListSource;
    ref: string;
    title: string | null;
    fetchedAt: number;
    username: string;
    displayName: string;
    name: string;
    quantity: number;
    finish: Finish;
    set: string | null;
    collectorNumber: string | null;
    variant: string | null;
    image: string | null;
    usd: number | null;
    approxPrice: boolean;
    usdRate: number | null; // the list's rate, else its owner's
};

const LIST_COLUMNS = `
    lists.id, lists.user_id AS userId, lists.source, lists.ref, lists.title, lists.status,
    lists.created_at AS createdAt, lists.reviewed_at AS reviewedAt, lists.edited_at AS editedAt,
    lists.fetched_at AS fetchedAt, lists.next_fetch_at AS nextFetchAt, lists.last_error AS lastError,
    lists.failures, lists.card_count AS cardCount, lists.usd_rate AS usdRate`;

// Traders' lists and the cards read from them. Only approved lists of users who aren't banned reach search or the
// refresh job; pending and rejected ones are never fetched.
export class ListStore {
    constructor(private readonly db: Database) {}

    // A new list waits for review. null when this list was submitted before, by anyone: one list, one owner.
    submit(
        userId: number,
        link: ListLink,
        now = Date.now()
    ): TraderList | null {
        return this.db
            .query<TraderList, [number, string, string, number]>(
                `INSERT INTO lists (user_id, source, ref, created_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT (source, ref) DO NOTHING
                 RETURNING ${LIST_COLUMNS}`
            )
            .get(userId, link.source, link.ref, now);
    }

    get(id: number): TraderList | null {
        return this.db
            .query<TraderList, [number]>(
                `SELECT ${LIST_COLUMNS} FROM lists WHERE id = ?`
            )
            .get(id);
    }

    // A user's own lists, newest first.
    ofUser(userId: number): TraderList[] {
        return this.db
            .query<TraderList, [number]>(
                `SELECT ${LIST_COLUMNS} FROM lists WHERE user_id = ? ORDER BY created_at DESC, id DESC`
            )
            .all(userId);
    }

    // Deletes a list, if it's this user's.
    remove(id: number, userId: number): boolean {
        return (
            this.db.run('DELETE FROM lists WHERE id = ? AND user_id = ?', [
                id,
                userId
            ]).changes > 0
        );
    }

    // The owner's rate for one list (null: back to their own default). Only the owner can set it.
    setUsdRate(id: number, userId: number, rate: number | null): boolean {
        return (
            this.db.run(
                'UPDATE lists SET usd_rate = ? WHERE id = ? AND user_id = ?',
                [rate, id, userId]
            ).changes > 0
        );
    }

    // Lists in one state, oldest first: the moderation queue is `withStatus('pending')`. Without a state, every
    // list, newest first (what a moderator's search looks through).
    withStatus(status?: ListStatus): ReviewedList[] {
        return this.db
            .query<Omit<ReviewedList, 'banned'> & { banned: number }, string[]>(
                `SELECT ${LIST_COLUMNS}, users.username, users.display_name AS displayName, users.banned,
                        users.usd_rate AS ownerUsdRate
                 FROM lists JOIN users ON users.id = lists.user_id
                 ${
                     status
                         ? 'WHERE lists.status = ? ORDER BY lists.created_at, lists.id'
                         : 'ORDER BY lists.created_at DESC, lists.id DESC'
                 }`
            )
            .all(...(status ? [status] : []))
            .map((l) => ({ ...l, banned: l.banned === 1 }));
    }

    // Approving makes the list due at once, so it's read right away; later refreshes follow the daily schedule.
    // Rejecting takes it off the schedule, and out of search if it was approved before.
    review(id: number, status: 'approved' | 'rejected', now = Date.now()) {
        return (
            this.db.run(
                `UPDATE lists SET status = ?, reviewed_at = ?, next_fetch_at = ?, failures = 0 WHERE id = ?`,
                [status, now, status === 'approved' ? now : null, id]
            ).changes > 0
        );
    }

    // A moderator's "refresh now": makes approved lists (`ids`, or all of them) due at once, and returns the ones it
    // moved. Lists already due are left out, so a second click while they're being read doesn't read them twice;
    // so are banned users' lists, which wait until the ban is lifted.
    refreshNow(ids: number[] | 'all', now = Date.now()): number[] {
        if (ids !== 'all' && ids.length === 0) return [];
        const only =
            ids === 'all' ? '' : `AND id IN (${ids.map(() => '?').join(', ')})`;
        return this.db
            .query<{ id: number }, number[]>(
                `UPDATE lists SET next_fetch_at = ?
                 WHERE status = 'approved' AND next_fetch_at > ? ${only}
                   AND user_id NOT IN (SELECT id FROM users WHERE banned = 1)
                 RETURNING id`
            )
            .all(now, now, ...(ids === 'all' ? [] : ids))
            .map((r) => r.id)
            .sort((a, b) => a - b);
    }

    // One list, if it's approved, due and its owner isn't banned: what an approval or a moderator's refresh reads.
    dueList(id: number, now = Date.now()): TraderList | null {
        return this.db
            .query<TraderList, [number, number]>(
                `SELECT ${LIST_COLUMNS} FROM lists JOIN users ON users.id = lists.user_id
                 WHERE lists.id = ? AND lists.status = 'approved' AND lists.next_fetch_at <= ? AND users.banned = 0`
            )
            .get(id, now);
    }

    // Approved lists whose refresh is due, most overdue first, leaving out `except` (the ones a pass has read).
    // Banned users' lists wait until the ban is lifted.
    due(now = Date.now(), limit = 10, except: number[] = []): TraderList[] {
        return this.db
            .query<TraderList, [number, string, number]>(
                `SELECT ${LIST_COLUMNS} FROM lists JOIN users ON users.id = lists.user_id
                 WHERE lists.status = 'approved' AND lists.next_fetch_at <= ? AND users.banned = 0
                   AND lists.id NOT IN (SELECT value FROM json_each(?))
                 ORDER BY lists.next_fetch_at, lists.id LIMIT ?`
            )
            .all(now, JSON.stringify(except), limit);
    }

    // A successful refresh: the list's cards are replaced as a whole. `nextFetchAt` schedules the next one.
    saveCards(
        id: number,
        list: Omit<ParsedList, 'cards'> & { cards: StoredCard[] },
        now: number,
        nextFetchAt: number
    ) {
        const insert = this.db.query(
            `INSERT INTO list_cards (list_id, name, name_key, quantity, finish, set_code, collector_number,
                                     variant, scryfall_id, image, usd, approx_price)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        this.db.transaction(() => {
            this.db.run('DELETE FROM list_cards WHERE list_id = ?', [id]);
            for (const c of list.cards)
                insert.run(
                    id,
                    c.name,
                    normalize(c.name),
                    c.quantity,
                    c.finish,
                    c.set ?? null,
                    c.collectorNumber ?? null,
                    c.variant ?? null,
                    c.scryfallId ?? null,
                    c.image ?? null,
                    c.usd ?? null,
                    c.approxPrice ? 1 : 0
                );
            this.db.run(
                `UPDATE lists SET title = ?, edited_at = ?, fetched_at = ?, next_fetch_at = ?, last_error = NULL,
                                  failures = 0, card_count = ?
                 WHERE id = ?`,
                [
                    list.title ?? null,
                    list.editedAt ?? null,
                    now,
                    nextFetchAt,
                    list.cards.reduce((n, c) => n + c.quantity, 0),
                    id
                ]
            );
        })();
    }

    // A failed refresh keeps the cards from the last good one; the caller backs off through `nextFetchAt`.
    saveFailure(id: number, error: ListRefreshError, nextFetchAt: number) {
        this.db.run(
            `UPDATE lists SET last_error = ?, failures = failures + 1, next_fetch_at = ? WHERE id = ?`,
            [error, nextFetchAt, id]
        );
    }

    // What the traders' lists have of a card. `card` and `fullName` as the searchers get them (CardSearcher):
    // a list may name a double-faced card by its front face or by both.
    offers(card: string, fullName = card): ListOffer[] {
        const rows = this.db
            .query<
                Omit<ListOffer, 'approxPrice'> & { approxPrice: number },
                [string, string]
            >(
                `SELECT lists.id AS listId, lists.source, lists.ref, lists.title, lists.fetched_at AS fetchedAt,
                        users.username, users.display_name AS displayName,
                        c.name, c.quantity, c.finish, c.set_code AS "set", c.collector_number AS collectorNumber,
                        c.variant, c.image, c.usd, c.approx_price AS approxPrice,
                        COALESCE(lists.usd_rate, users.usd_rate) AS usdRate
                 FROM list_cards c
                     JOIN lists ON lists.id = c.list_id
                     JOIN users ON users.id = lists.user_id
                 WHERE c.name_key IN (?, ?) AND lists.status = 'approved' AND users.banned = 0
                 ORDER BY c.usd IS NULL, c.usd, lists.id`
            )
            .all(normalize(card), normalize(fullName));
        return rows.map((r) => ({ ...r, approxPrice: r.approxPrice === 1 }));
    }
}
