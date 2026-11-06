import type { CardResult, ShopId } from '../shops';
import type { CardSearcher } from './card-searcher';

// Remembers one shop's results per card for `ttlMs`. Popular cards get searched over and over, and every miss
// waits in the shop's request queue (see ShopClient). The promise itself is cached, so identical searches that
// are already in flight share one set of requests. Failures aren't cached — the next search retries.
export class CachedCardSearcher implements CardSearcher {
    readonly shop: ShopId;
    // Insertion order = expiry order (fixed TTL), so expired entries are always at the front.
    private readonly cache = new Map<
        string,
        { expires: number; results: Promise<CardResult[]> }
    >();

    constructor(
        private readonly inner: CardSearcher,
        private readonly ttlMs = 5 * 60_000
    ) {
        this.shop = inner.shop;
    }

    search(card: string): Promise<CardResult[]> {
        const key = card.toLowerCase();
        const now = Date.now();
        const hit = this.cache.get(key);
        if (hit && hit.expires > now) return hit.results;

        this.evictExpired(now);
        const results = this.inner.search(card);
        this.cache.delete(key); // re-insert at the back, keeping the expiry order
        this.cache.set(key, { expires: now + this.ttlMs, results });
        results.catch(() => {
            if (this.cache.get(key)?.results === results)
                this.cache.delete(key);
        });
        return results;
    }

    private evictExpired(now: number) {
        for (const [key, entry] of this.cache) {
            if (entry.expires > now) break;
            this.cache.delete(key);
        }
    }
}
