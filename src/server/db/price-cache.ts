import type { Database } from 'bun:sqlite';

// A printing's prices in USD, as Scryfall gives them (null when it has none for that finish).
export type CardPrice = {
    usd: number | null;
    usdFoil: number | null;
    usdEtched: number | null;
    scryfallId: string | null; // the printing the prices are for
    image: string | null;
};

// Scryfall's prices for the cards in traders' lists, so the daily refresh asks Scryfall only for those it hasn't
// seen within `maxAgeMs` (Scryfall updates prices once a day). Keys say what was asked (see the refresh job):
// "id:<scryfall id>", "set:<set>/<name key>" or "name:<name key>".
export class PriceCache {
    constructor(
        private readonly db: Database,
        private readonly maxAgeMs = 24 * 60 * 60_000
    ) {}

    // The fresh prices among `keys`; a key that's missing or stale isn't in the map.
    get(keys: string[], now = Date.now()): Map<string, CardPrice> {
        const found = new Map<string, CardPrice>();
        const query = this.db.query<
            CardPrice & { key: string },
            [string, number]
        >(
            `SELECT key, usd, usd_foil AS usdFoil, usd_etched AS usdEtched, scryfall_id AS scryfallId, image
             FROM card_prices WHERE key = ? AND fetched_at > ?`
        );
        for (const key of new Set(keys)) {
            const row = query.get(key, now - this.maxAgeMs);
            if (row) {
                const { key: _, ...price } = row;
                found.set(key, price);
            }
        }
        return found;
    }

    set(prices: Map<string, CardPrice>, now = Date.now()) {
        const upsert = this.db.query(
            `INSERT INTO card_prices (key, usd, usd_foil, usd_etched, scryfall_id, image, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET usd = excluded.usd, usd_foil = excluded.usd_foil,
                 usd_etched = excluded.usd_etched, scryfall_id = excluded.scryfall_id, image = excluded.image,
                 fetched_at = excluded.fetched_at`
        );
        this.db.transaction(() => {
            for (const [key, p] of prices)
                upsert.run(
                    key,
                    p.usd,
                    p.usdFoil,
                    p.usdEtched,
                    p.scryfallId,
                    p.image,
                    now
                );
        })();
    }

    // Drops prices too old to use; returns how many.
    purge(now = Date.now()): number {
        return this.db.run('DELETE FROM card_prices WHERE fetched_at <= ?', [
            now - this.maxAgeMs
        ]).changes;
    }
}
