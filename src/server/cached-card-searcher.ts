import { normalize } from '../matching';
import type { CardResult } from '../search-result';
import type { ShopId } from '../shops';
import type { CardSearcher } from './card-searcher';

type Entry = {
    expires: number;
    results: Promise<CardResult[]>;
    pending: boolean;
    controller: AbortController; // aborts the shop search
    waiters: number; // callers still waiting on a pending search; Infinity once one can't give up (no signal)
};

// Remembers one shop's results per card for `ttlMs`. Popular cards get searched over and over, and every miss
// waits in the shop's request queue (see ShopClient). The promise itself is cached, so identical searches that
// are already in flight share one set of requests. Failures aren't cached — the next search retries.
// Each caller can give up through its own signal; the shared search is aborted only when the last caller
// still waiting on it gives up, which takes its requests out of the shop's queue.
export class CachedCardSearcher implements CardSearcher {
    readonly shop: ShopId;
    // Insertion order = expiry order (fixed TTL), so expired entries are always at the front.
    private readonly cache = new Map<string, Entry>();

    constructor(
        private readonly inner: CardSearcher,
        private readonly ttlMs = 5 * 60_000
    ) {
        this.shop = inner.shop;
    }

    search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        if (signal?.aborted) return Promise.reject(signal.reason);
        // "Æther Vial" and "aether vial" are the same search
        const key = normalize(card);
        const now = Date.now();
        let entry = this.cache.get(key);
        if (!entry || entry.expires <= now) {
            this.evictExpired(now);
            entry = this.start(key, card, now);
        }
        return this.wait(key, entry, signal);
    }

    private start(key: string, card: string, now: number): Entry {
        const controller = new AbortController();
        const results = this.inner.search(card, controller.signal);
        const entry: Entry = {
            expires: now + this.ttlMs,
            results,
            pending: true,
            controller,
            waiters: 0
        };
        results.then(
            () => (entry.pending = false),
            () => {
                entry.pending = false;
                this.drop(key, entry);
            }
        );
        this.cache.delete(key); // re-insert at the back, keeping the expiry order
        this.cache.set(key, entry);
        return entry;
    }

    // The shared results, or a rejection as soon as this caller's own signal aborts.
    private wait(
        key: string,
        entry: Entry,
        signal?: AbortSignal
    ): Promise<CardResult[]> {
        if (!entry.pending) return entry.results;
        if (!signal) {
            entry.waiters = Infinity;
            return entry.results;
        }
        entry.waiters++;
        return new Promise((resolve, reject) => {
            const onAbort = () => {
                reject(signal.reason);
                if (--entry.waiters === 0 && entry.pending) {
                    entry.controller.abort(signal.reason);
                    this.drop(key, entry);
                }
            };
            signal.addEventListener('abort', onAbort, { once: true });
            entry.results
                .finally(() => signal.removeEventListener('abort', onAbort))
                .then(resolve, reject);
        });
    }

    private drop(key: string, entry: Entry) {
        if (this.cache.get(key) === entry) this.cache.delete(key);
    }

    private evictExpired(now: number) {
        for (const [key, entry] of this.cache) {
            if (entry.expires > now) break;
            this.cache.delete(key);
        }
    }
}
