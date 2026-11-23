import { normalize } from '@/shared/matching';
import type { CardIndex } from '@/server/scryfall/card-index';
import type { ListStore, TraderList } from '@/server/lists/list-store';
import { logger } from '@/server/observability/logger';
import { mergeRows } from '@/server/lists/list-card';
import type { ListPrices } from '@/server/lists/list-prices';
import {
    ListRefreshFailure,
    type ListReader
} from '@/server/lists/list-reader';
import {
    isNight,
    NIGHT,
    NIGHT_TICK,
    nextSlot
} from '@/server/lists/night-schedule';

// A list is read once a night, at its slot (night-schedule.ts): Scryfall's prices change daily, and traders keep
// their lists up to date at the source.
const DAY_MS = 24 * 60 * 60_000;
// After a read at night, the next is the list's slot at least this much later: tomorrow night's, even for a read
// before its slot tonight. After one in the day (an approval, a moderator's refresh), it's the next slot: tonight's.
export const MIN_GAP_MS = 12 * 60 * 60_000;

export const nextRead = (listId: number, readAt: number) =>
    nextSlot(listId, isNight(readAt) ? readAt + MIN_GAP_MS : readAt);
// After a failure the list is tried again after an hour, then 2, 4, 8, 16, and from then on daily; a retry that
// would fall in the day waits for the list's slot instead.
const FIRST_RETRY_MS = 60 * 60_000;
// Due lists fetched from the database at a time; each query leaves out the ones the pass has read.
const BATCH = 10;

export const retryDelay = (failures: number) =>
    Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), DAY_MS);

// The in-process scheduler (Bun.cron), a parameter for tests.
type Schedule = (
    cron: string,
    handler: () => unknown,
    options: { tz: string }
) => { stop(): unknown };

// Reads approved lists when they're due (see ListStore.due), in the server process: the schedule is in the database,
// so it survives restarts. Scheduled reads happen at night (night-schedule.ts), each list at its own slot; lists are
// read one at a time, which keeps the sources' and Scryfall's traffic to a trickle.
// A refresh replaces the list's cards; a failed one keeps the old cards, records why, and is retried later.
export class ListRefresher {
    private running: Promise<void> | null = null;
    // what the running pass should read next: the lists named by approvals and moderators, or every due list
    private wanted: Set<number> | 'all' | null = null;
    private job: { stop(): unknown } | undefined;

    constructor(
        private readonly lists: ListStore,
        private readonly reader: Pick<ListReader, 'read'>,
        private readonly prices: Pick<ListPrices, 'price' | 'purge'>,
        private readonly index?: Pick<CardIndex, 'find'>,
        private readonly now = () => Date.now()
    ) {}

    // Checks for due lists every 5 minutes through the night, and at once when started at night (a restart).
    // Under `bun --hot`, Bun stops the job before each reload, so reloads don't pile up refreshers.
    start(
        schedule: Schedule = (cron, handler, options) =>
            Bun.cron(cron, handler, options)
    ) {
        this.job ??= schedule(NIGHT_TICK, () => this.run(), { tz: NIGHT.tz });
        if (isNight(this.now())) void this.run();
    }

    stop() {
        this.job?.stop();
        this.job = undefined;
    }

    // Reads the lists that are due: every one (the night's check), or only `ids` (just approved, or a moderator's
    // refresh), whatever the hour. Called while a pass is going, they're read in another pass right after.
    // Never rejects: its callers (the cron job, an approval's route) don't wait for it.
    run(ids?: number[]): Promise<void> {
        this.wanted =
            ids === undefined || this.wanted === 'all'
                ? 'all'
                : new Set([...(this.wanted ?? []), ...ids]);
        this.running ??= this.passes();
        return this.running;
    }

    private async passes() {
        // a tick later, so `running` is set before any of it runs: a run() from inside it joins this one
        await Promise.resolve();
        try {
            while (this.wanted) {
                const wanted = this.wanted;
                this.wanted = null;
                try {
                    await (wanted === 'all'
                        ? this.refreshDue()
                        : this.refreshLists(wanted));
                } catch (error) {
                    // the database, most likely (a failed read is handled in refresh); the lists stay due for the
                    // next pass, and any asked for meanwhile are still read
                    logger.error('list refresh pass failed', { error });
                }
            }
        } finally {
            // in the same tick as the loop's last check, so a run() can't slip in between and be left unread
            this.running = null;
        }
    }

    private async refreshDue() {
        this.prices.purge(this.now());
        // each list once per pass, even if saving its result failed and left it due
        const done = new Set<number>();
        for (;;) {
            const due = this.lists.due(this.now(), BATCH, [...done]);
            if (due.length === 0) return;
            for (const list of due) {
                done.add(list.id);
                await this.refresh(list);
            }
        }
    }

    // Only these lists, each if it's still approved and due (ListStore.review and refreshNow make it so) and its
    // owner isn't banned: an approval doesn't check the owner.
    private async refreshLists(ids: Set<number>) {
        for (const id of ids) {
            const list = this.lists.dueList(id, this.now());
            if (list) await this.refresh(list);
        }
    }

    private async refresh(list: TraderList) {
        const started = this.now();
        try {
            const read = await this.reader.read(list);
            // the cards' own names, so search finds them however the list spells them (see cardName)
            const cards = mergeRows(
                read.cards.map((c) => ({ ...c, name: this.cardName(c.name) }))
            );
            const priced = await this.prices.price(cards, this.now());
            this.lists.saveCards(
                list.id,
                { ...read, cards: priced },
                this.now(),
                nextRead(list.id, this.now())
            );
            logger.info('list refreshed', {
                list: list.id,
                source: list.source,
                rows: priced.length,
                ms: this.now() - started
            });
        } catch (error) {
            // deleted by its owner while it was being read: nothing to record
            if (!this.lists.get(list.id)) return;
            const known = error instanceof ListRefreshFailure;
            const reason = known ? error.reason : 'unavailable';
            const retry = this.now() + retryDelay(list.failures + 1);
            this.lists.saveFailure(
                list.id,
                reason,
                isNight(retry) ? retry : nextSlot(list.id, retry)
            );
            // a known failure is the source's doing; anything else is a bug here
            (known ? logger.warn : logger.error)('list refresh failed', {
                list: list.id,
                source: list.source,
                reason,
                failures: list.failures + 1,
                error
            });
        }
    }

    // The card's name as Scryfall spells it, when the index knows the card under exactly this name or one of its
    // faces: "bonecrusher giant" → "Bonecrusher Giant // Stomp", which is what ListStore.offers matches against.
    // The index's looser matches (typos, word pieces) are left out: a list names its cards in full, so a loose
    // match is more likely a card newer than the index than a typo. Anything else is kept as the list has it.
    private cardName(name: string): string {
        const card = this.index?.find(name);
        if (!card) return name;
        const names = [
            card.name,
            ...(card.card_faces ?? []).map((f) => f.name)
        ];
        return names.some((n) => normalize(n) === normalize(name))
            ? card.name
            : name;
    }
}
