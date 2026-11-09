// How long the first item waits for others to join its request by default. The frontend sends cards a few at a
// time, so they arrive within milliseconds of each other.
const BATCH_WINDOW_MS = 20;

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

// Sends one result per item, in the items' order. A rejection fails every item in the batch.
export type SendBatch<T, R> = (items: T[], signal: AbortSignal) => Promise<R[]>;

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

    add(item: T, signal?: AbortSignal): Promise<R> {
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
            this.schedule();
        });
    }

    private abandon(entry: Entry<T, R>) {
        const reason = entry.signal!.reason;
        entry.reject(reason);
        const { batch } = entry;
        if (!batch) this.pending.splice(this.pending.indexOf(entry), 1);
        else if (--batch.waiting === 0) batch.controller.abort(reason);
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
            const results = await this.sendBatch(
                entries.map((e) => e.item),
                batch.controller.signal
            );
            entries.forEach((e, i) => e.resolve(results[i]!));
        } catch (err) {
            // a 429 or timeout fails the whole batch; each card shows the shop as failed
            for (const e of entries) e.reject(err);
        } finally {
            this.sending = false;
            if (this.pending.length > 0) void this.send();
        }
    }
}
