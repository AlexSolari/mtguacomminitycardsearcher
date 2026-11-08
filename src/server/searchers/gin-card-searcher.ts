import { parseGin, type GinResponse } from '../parsers/api/gin';
import type { CardResult } from '../../search-result';
import { warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

// The API takes up to 100 lookups per request.
const MAX_BATCH = 100;
// How long the first search waits for others to join its request. The frontend sends cards a few at a time, so
// they arrive within milliseconds of each other.
const BATCH_WINDOW_MS = 20;

type Batch = {
    controller: AbortController;
    waiting: number; // lookups that still want the answer; the request is aborted when this reaches 0
};

type Lookup = {
    card: string;
    signal?: AbortSignal;
    resolve: (results: CardResult[]) => void;
    reject: (err: unknown) => void;
    batch?: Batch; // set once the lookup is sent
};

// MTGin's partner API (POST /api/public/v1/search) needs a key, read from MTGIN_API_KEY (Bun loads .env).
// The key allows 60 requests a minute, shared by every user of this server, so searches are batched: searches that
// arrive together go out as one request, and only one request is in flight at a time. Whatever arrives meanwhile
// waits and goes out as the next batch.
// The API matches names exactly (case-insensitive, either face of a double-faced card), so it never returns the fuzzy
// "other matches" a search page would.
export class GinCardSearcher implements CardSearcher {
    readonly shop = 'gin';
    private pending: Lookup[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private sending = false;

    constructor(
        // one request a second stays within the key's 60 a minute
        private readonly client = new ShopClient('https://mtgin.kyiv.ua', {
            intervalMs: 1000
        }),
        private readonly apiKey = process.env.MTGIN_API_KEY
    ) {}

    search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        if (!this.apiKey)
            return Promise.reject(new Error('MTGIN_API_KEY is not set'));
        if (signal?.aborted) return Promise.reject(signal.reason);
        return new Promise((resolve, reject) => {
            const onAbort = () => this.abandon(lookup);
            const done = () => signal?.removeEventListener('abort', onAbort);
            const lookup: Lookup = {
                card,
                signal,
                resolve: (results) => {
                    done();
                    resolve(results);
                },
                reject: (err) => {
                    done();
                    reject(err);
                }
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            this.pending.push(lookup);
            this.schedule();
        });
    }

    // A caller gave up: it leaves the next batch, or, once sent, the request is aborted when nobody else in its
    // batch is still waiting (which takes it out of the client's queue).
    private abandon(lookup: Lookup) {
        const reason = lookup.signal!.reason;
        lookup.reject(reason);
        const { batch } = lookup;
        if (!batch) this.pending.splice(this.pending.indexOf(lookup), 1);
        else if (--batch.waiting === 0) batch.controller.abort(reason);
    }

    private schedule() {
        if (this.sending || this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.send();
        }, BATCH_WINDOW_MS);
    }

    private async send() {
        const lookups = this.pending.splice(0, MAX_BATCH);
        if (lookups.length === 0) return;
        this.sending = true;
        const batch: Batch = {
            controller: new AbortController(),
            waiting: lookups.length
        };
        for (const l of lookups) l.batch = batch;

        const url = this.client.url('/api/public/v1/search');
        try {
            const json = await this.client.fetchJson<GinResponse>(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cards: lookups.map((l) => ({ name: l.card }))
                }),
                signal: batch.controller.signal
            });
            // results come back in request order
            lookups.forEach((l, i) =>
                l.resolve(
                    warnIfEmpty(
                        this.shop,
                        `${url} (${JSON.stringify(l.card)})`,
                        parseGin(json?.results?.[i], this.client.baseUrl)
                    )
                )
            );
        } catch (err) {
            // a 429 or timeout fails the whole batch; each card shows MTGin as failed
            for (const l of lookups) l.reject(err);
        } finally {
            this.sending = false;
            if (this.pending.length > 0) void this.send();
        }
    }
}
