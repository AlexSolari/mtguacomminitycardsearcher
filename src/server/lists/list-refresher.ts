import { normalize } from '../../matching';
import type { CardIndex } from '../card-index';
import type { ListStore, TraderList } from '../db/list-store';
import { logger } from '../logger';
import { mergeRows } from './list-card';
import type { ListPrices } from './list-prices';
import { ListRefreshFailure, type ListReader } from './list-reader';

// A list is read again this long after its last good read: Scryfall's prices change daily, and traders keep their
// lists up to date at the source.
export const REFRESH_MS = 24 * 60 * 60_000;
// How often the schedule is checked. Approval doesn't wait for it (see `run`).
export const TICK_MS = 5 * 60_000;
// After a failure the list is tried again after an hour, then 2, 4, 8, 16, and from then on daily.
const FIRST_RETRY_MS = 60 * 60_000;
// Due lists fetched from the database at a time.
const BATCH = 10;

export const retryDelay = (failures: number) =>
    Math.min(FIRST_RETRY_MS * 2 ** (failures - 1), REFRESH_MS);

// Reads approved lists when they're due (see ListStore.due), in the server process: the schedule is in the database,
// so it survives restarts, and a list approved at 14:00 refreshes around 14:00 each day. Lists are read one at a
// time, which keeps the sources' and Scryfall's traffic to a trickle.
// A refresh replaces the list's cards; a failed one keeps the old cards, records why, and is retried later.
export class ListRefresher {
    private running: Promise<void> | null = null;
    private again = false;
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly lists: ListStore,
        private readonly reader: Pick<ListReader, 'read'>,
        private readonly prices: Pick<ListPrices, 'price' | 'purge'>,
        private readonly index?: Pick<CardIndex, 'find'>,
        private readonly now = () => Date.now()
    ) {}

    start(tickMs = TICK_MS) {
        this.timer ??= setInterval(() => void this.run(), tickMs);
        void this.run();
    }

    stop() {
        clearInterval(this.timer);
        this.timer = undefined;
    }

    // Refreshes every list that's due. Called while a run is going (a list just approved), it runs once more after,
    // so the new list isn't left waiting for the next tick.
    run(): Promise<void> {
        if (this.running) {
            this.again = true;
            return this.running;
        }
        // started a tick later, so `running` is set before any of it runs: a run() from inside it joins this one
        this.running = Promise.resolve()
            .then(async () => {
                do {
                    this.again = false;
                    await this.refreshDue();
                } while (this.again);
            })
            .finally(() => (this.running = null));
        return this.running;
    }

    private async refreshDue() {
        this.prices.purge(this.now());
        // each list once per pass, even if saving its result failed and left it due
        const done = new Set<number>();
        for (;;) {
            const due = this.lists
                .due(this.now(), BATCH + done.size)
                .filter((l) => !done.has(l.id));
            if (due.length === 0) return;
            for (const list of due) {
                done.add(list.id);
                await this.refresh(list);
            }
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
                this.now() + REFRESH_MS
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
            this.lists.saveFailure(
                list.id,
                reason,
                this.now() + retryDelay(list.failures + 1)
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
