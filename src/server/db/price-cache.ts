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

    // The fresh prices among `keys`; a key that's missing or stale isn't in the map. One query for them all: a big
    // list has thousands of keys.
    get(keys: string[], now = Date.now()): Map<string, CardPrice> {
        const rows = this.db
            .query<CardPrice & { key: string }, [string, number]>(
                `SELECT key, usd, usd_foil AS usdFoil, usd_etched AS usdEtched, scryfall_id AS scryfallId, image
                 FROM card_prices WHERE key IN (SELECT value FROM json_each(?)) AND fetched_at > ?`
            )
            .all(JSON.stringify([...new Set(keys)]), now - this.maxAgeMs);
        return new Map(rows.map(({ key, ...price }) => [key, price]));
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
