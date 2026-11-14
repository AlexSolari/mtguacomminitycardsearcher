import { normalize } from '../matching';
import type { ShopId } from '../shops';
import { logger } from './logger';
import { HttpError, ShopRequestError } from './shop-client';

// How long the first item waits for others to join its request by default. A search's cards reach the batchers
// as their names resolve, the bulk of a list within a few milliseconds of each other. A search's first cards
// don't wait for it (see `urgent`).
export const BATCH_WINDOW_MS = 100;

type Batch = {
    controller: AbortController;
    waiting: number; // items that still want the answer; the request is aborted when this reaches 0
};

type Entry<T, R> = {
    item: T;
    signal?: AbortSignal;
    resolve: (result: R) => void;
    reject: (err: unknown) => void;
    batch?: Batch; // set once the entry is sent
};

// Sends one result per item, in the items' order. An Error in an item's place fails only that item (see
// pairAnswers). A rejection fails every item in the batch, except one that blames the input (see `rejectsInput`).
export type SendBatch<T, R> = (
    items: T[],
    signal: AbortSignal
) => Promise<(R | Error)[]>;

// For APIs that take many lookups per request under a tight request budget (MTGin, Nerdik): items that arrive
// together go out as one request of up to `maxBatch`, and only one request is in flight at a time. Whatever arrives
// meanwhile waits and goes out as the next batch.
// Each caller can give up through its own signal: it leaves the next batch, or, once sent, the request is aborted
// when nobody else in its batch is still waiting (which takes it out of the shop client's queue).
export class Batcher<T, R> {
    private pending: Entry<T, R>[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private sending = false;

    constructor(
        private readonly sendBatch: SendBatch<T, R>,
        private readonly maxBatch: number,
        private readonly windowMs = BATCH_WINDOW_MS
    ) {}

    // An `urgent` item goes out at once (with whatever else is waiting) instead of waiting for the window.
    add(item: T, signal?: AbortSignal, urgent = false): Promise<R> {
        if (signal?.aborted) return Promise.reject(signal.reason);
        return new Promise((resolve, reject) => {
            const onAbort = () => this.abandon(entry);
            const done = () => signal?.removeEventListener('abort', onAbort);
            const entry: Entry<T, R> = {
                item,
                signal,
                resolve: (result) => {
                    done();
                    resolve(result);
                },
                reject: (err) => {
                    done();
                    reject(err);
                }
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            this.pending.push(entry);
            if (urgent) this.flush();
            else this.schedule();
        });
    }

    private abandon(entry: Entry<T, R>) {
        const reason = entry.signal!.reason;
        entry.reject(reason);
        const { batch } = entry;
        if (!batch) this.pending.splice(this.pending.indexOf(entry), 1);
        else if (--batch.waiting === 0) batch.controller.abort(reason);
    }

    private flush() {
        if (this.sending) return; // sent as soon as the batch in flight is answered
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        void this.send();
    }

    private schedule() {
        if (this.sending || this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.send();
        }, this.windowMs);
    }

    private async send() {
        const entries = this.pending.splice(0, this.maxBatch);
        if (entries.length === 0) return;
        this.sending = true;
        const batch: Batch = {
            controller: new AbortController(),
            waiting: entries.length
        };
        for (const e of entries) e.batch = batch;

        try {
            await this.sendEntries(entries, batch.controller.signal);
        } finally {
            this.sending = false;
            if (this.pending.length > 0) void this.send();
        }
    }

    // A batch holds different users' items, so when the API rejects its input (one junk name makes the whole
    // request a 400), the batch is split in half and each half retried: only the bad item's own request fails.
    // That's about 2·log₂(n) extra requests per bad item. A 429 or timeout isn't the input's fault, and fails the
    // whole batch; each card shows the shop as failed.
    private async sendEntries(entries: Entry<T, R>[], signal: AbortSignal) {
        try {
            const results = await this.sendBatch(
                entries.map((e) => e.item),
                signal
            );
            entries.forEach((e, i) => {
                const result = results[i]!;
                if (result instanceof Error) e.reject(result);
                else e.resolve(result);
            });
        } catch (err) {
            if (entries.length > 1 && rejectsInput(err) && !signal.aborted) {
                const half = Math.ceil(entries.length / 2);
                await this.sendEntries(entries.slice(0, half), signal);
                await this.sendEntries(entries.slice(half), signal);
            } else for (const e of entries) e.reject(err);
        }
    }
}

// 400 Bad Request, 413 Content Too Large, 422 Unprocessable Content. Not 401/403: a bad key or a block fails every
// request, so splitting would only spend the budget.
export function rejectsInput(err: unknown) {
    return err instanceof HttpError && [400, 413, 422].includes(err.status);
}

// A batch API answers its names in request order, but pairing by position alone would put every card after a
// dropped or reordered answer on another card's offers: wrong prices, shown without an error and cached. All three
// APIs echo each answer's name as sent (MTGin `query.name`, Mana Vault `query`, Nerdik `name`), so each name gets the
// answer echoing it: in its own place, or anywhere in the batch when the answers are out of order. An answer with
// no echo is taken by position only when there's one per name. A name left without an answer fails on its own.
export function pairAnswers<A>(
    shop: ShopId,
    names: string[],
    answers: (A | null | undefined)[] | null | undefined,
    echoOf: (answer: A) => unknown
): (A | Error)[] {
    const list = (Array.isArray(answers) ? answers : []).map((answer) => ({
        answer,
        // anything but a string isn't an echo; normalize() would throw on it and fail the whole batch
        echo: answer == null ? undefined : asString(echoOf(answer))
    }));
    const onePerName = list.length === names.length;
    const fits = (at: (typeof list)[number] | undefined, name: string) =>
        at?.answer != null &&
        (at.echo === undefined
            ? onePerName
            : normalize(at.echo) === normalize(name));
    let moved = 0;
    let missing = 0;
    const paired = names.map((name, i) => {
        if (fits(list[i], name)) return list[i]!.answer!;
        const found = list.find(
            (at) => at.echo !== undefined && fits(at, name)
        );
        if (found) {
            moved++;
            return found.answer!;
        }
        missing++;
        return new ShopRequestError('no answer for this card');
    });
    if (moved + missing > 0)
        logger.warn("batch answers don't match the request", {
            shop,
            sent: names.length,
            answered: list.length,
            moved,
            missing
        });
    return paired;
}

const asString = (value: unknown) =>
    typeof value === 'string' ? value : undefined;
