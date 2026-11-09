import { normalize } from '../matching';
import { logger } from './logger';
import { HttpError, ShopClient } from './shop-client';

// Names already resolved, kept for the life of the process: card names don't change. Bounded so a stream of
// junk input can't grow it forever; the oldest entries go first.
const MAX_CACHED = 10_000;

export type NameResolver = {
    resolve(card: string, signal?: AbortSignal): Promise<string>;
};

// The subset of Scryfall's card object we read (GET /cards/named?fuzzy=…):
//   { "object": "card", "name": "Overlord of the Balemurk", ... }
//   { "object": "card", "name": "Delver of Secrets // Insectile Aberration",
//     "card_faces": [{ "name": "Delver of Secrets" }, { "name": "Insectile Aberration" }], ... }
// An unknown or ambiguous name ("delver secrets" also fits "Delver of Secrets" and others) is a 404.
type ScryfallCard = { name: string; card_faces?: { name: string }[] };

// Turns a typed name into the card's real English name before the shops are searched: "overlord balemurk" →
// "Overlord of the Balemurk". The shops search by substring, so a missing word finds nothing.
// Falls back to the name as typed whenever Scryfall can't help: unknown, ambiguous, non-English, or failing.
export class ScryfallNameResolver implements NameResolver {
    private readonly cache = new Map<string, string>();

    constructor(
        // Scryfall asks for 50–100 ms between requests
        private readonly client = new ShopClient('https://api.scryfall.com', {
            intervalMs: 100,
            timeoutMs: 5_000,
            maxWaitMs: 5_000
        })
    ) {}

    async resolve(card: string, signal?: AbortSignal): Promise<string> {
        const key = normalize(card);
        const cached = this.cache.get(key);
        if (cached !== undefined) return cached;

        const url = this.client.url('/cards/named', { fuzzy: card });
        let resolved: string;
        try {
            const found = await this.client.fetchJson<ScryfallCard>(url, {
                signal,
                // Scryfall rejects requests without these
                headers: {
                    'User-Agent': 'searcher/0.1',
                    Accept: 'application/json'
                }
            });
            resolved = pickName(card, found);
        } catch (err) {
            if (signal?.aborted) throw err;
            if (err instanceof HttpError && err.status === 404) resolved = card;
            else {
                // not cached: the next search tries again
                logger.warn('name lookup failed, searching as typed', {
                    card,
                    error: err
                });
                return card;
            }
        }
        this.remember(key, resolved);
        return resolved;
    }

    private remember(key: string, name: string) {
        if (this.cache.size >= MAX_CACHED)
            this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, name);
    }
}

// Keeps the typed name when it already is the card (or one of its faces), so "Insectile Aberration" isn't
// swapped for the front face, and "aether vial" isn't rewritten for nothing. Otherwise, the front face: shops
// list double-faced cards under it, and a split card's full name ("Fire // Ice") still contains it.
function pickName(typed: string, card: ScryfallCard): string {
    const faces = card.card_faces?.map((f) => f.name) ?? [];
    const q = normalize(typed);
    if ([card.name, ...faces].some((n) => normalize(n) === q)) return typed;
    return faces[0] ?? card.name;
}
