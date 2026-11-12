import { normalize } from '../matching';
import { logger } from './logger';
import { HttpError, ShopClient } from './shop-client';

// Names already resolved, kept for the life of the process: card names don't change. Bounded so a stream of
// junk input can't grow it forever; the oldest entries go first.
const MAX_CACHED = 10_000;

// `name` is what shops search for: the typed name when it already is the card or one of its faces, else the front
// face. `fullName` is Scryfall's name for the whole card ("Bonecrusher Giant // Stomp"), for APIs that match only
// that (Nerdik's batch search). Both are the typed name when Scryfall can't place it.
export type ResolvedName = { name: string; fullName: string };

// `resolveAll` resolves a whole list, a promise per name in list order; without it, each name is resolved alone.
export type NameResolver = {
    resolve(card: string, signal?: AbortSignal): Promise<ResolvedName>;
    resolveAll?(cards: string[], signal?: AbortSignal): Promise<ResolvedName>[];
};

// A list this short is looked up name by name (GET /cards/named) rather than in one POST /cards/collection: the two
// endpoints have separate limits, so a short list ahead of a long one (the first cards of a search) is looked up
// while the long one's collection request runs.
const FUZZY_ONLY_MAX = 2;

// Names per POST /cards/collection, Scryfall's maximum.
const MAX_COLLECTION = 75;

// Scryfall rejects requests without these
const HEADERS = { 'User-Agent': 'searcher/0.1', Accept: 'application/json' };

// After a 429, Scryfall limits access for 30 s (its rate-limit docs) and its error says "try again after 60 seconds";
// sending more meanwhile risks a block. So lookups stop for this long, and names are searched as typed.
export const RATE_LIMIT_PAUSE_MS = 60_000;

// A lookup skipped because Scryfall rate-limited us (see RATE_LIMIT_PAUSE_MS).
class LookupsPaused extends Error {}

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
    private readonly cache = new Map<string, ResolvedName>();
    private pausedUntil = 0;

    constructor(
        // /cards/named and /cards/collection each allow 2 requests a second (https://scryfall.com/docs/api/rate-limits),
        // so each has its own client and queue. A name that would wait more than 5 s is searched as typed.
        private readonly client = scryfallClient(),
        private readonly now = () => Date.now(),
        private readonly collectionClient = scryfallClient()
    ) {}

    // Every Scryfall request goes through here, so a 429 stops them all (see RATE_LIMIT_PAUSE_MS).
    private async fetchJson<T>(
        url: string,
        init: RequestInit,
        client = this.client
    ): Promise<T> {
        if (this.now() < this.pausedUntil) throw new LookupsPaused();
        try {
            return await client.fetchJson<T>(url, init);
        } catch (err) {
            if (err instanceof HttpError && err.status === 429) {
                this.pausedUntil = this.now() + RATE_LIMIT_PAUSE_MS;
                logger.warn('Scryfall rate-limited us, pausing name lookups', {
                    pause_s: RATE_LIMIT_PAUSE_MS / 1000,
                    error: err
                });
                throw new LookupsPaused();
            }
            throw err;
        }
    }

    async resolve(card: string, signal?: AbortSignal): Promise<ResolvedName> {
        const key = normalize(card);
        const cached = this.cache.get(key);
        if (cached !== undefined) return cached;

        const asTyped = { name: card, fullName: card };
        const url = this.client.url('/cards/named', { fuzzy: card });
        let resolved: ResolvedName;
        try {
            const found = await this.fetchJson<ScryfallCard>(url, {
                signal,
                headers: HEADERS
            });
            resolved = { name: pickName(card, found), fullName: found.name };
        } catch (err) {
            if (signal?.aborted) throw err;
            if (err instanceof HttpError && err.status === 404)
                resolved = asTyped;
            // already logged once, when the pause began; not cached
            else if (err instanceof LookupsPaused) return asTyped;
            else {
                // not cached: the next search tries again
                logger.warn('name lookup failed, searching as typed', {
                    card,
                    error: err
                });
                return asTyped;
            }
        }
        this.remember(key, resolved);
        return resolved;
    }

    // A list's names, a request per 75 rather than one per name: most of a list is typed right, and an exact lookup
    // (POST /cards/collection) takes many names at once. The rest (misspelled, shortened) go through `resolve`.
    resolveAll(cards: string[], signal?: AbortSignal): Promise<ResolvedName>[] {
        const keys = cards.map(normalize);
        // one lookup per name, as first typed
        const missing = new Map<string, string>();
        keys.forEach((key, i) => {
            if (!this.cache.has(key) && !missing.has(key))
                missing.set(key, cards[i]!);
        });
        const exact =
            missing.size > FUZZY_ONLY_MAX
                ? this.lookupExact([...missing.values()], signal)
                : null;
        return cards.map(async (card, i) => {
            const key = keys[i]!;
            const cached = this.cache.get(key);
            if (cached) return cached;
            const found = (await exact)?.get(key);
            if (!found) return this.resolve(card, signal);
            const resolved = {
                name: pickName(card, found),
                fullName: found.name
            };
            this.remember(key, resolved);
            return resolved;
        });
    }

    // The cards Scryfall finds by exact name (either face, any case), by the normalized name and face names. A failed
    // request finds nothing, so its names fall back to `resolve` one by one.
    //   {"object":"list","not_found":[{"name":"overlord balemurk"}],
    //    "data":[{"name":"Fire // Ice","card_faces":[{"name":"Fire"},{"name":"Ice"}], ...}, ...]}
    private async lookupExact(
        cards: string[],
        signal?: AbortSignal
    ): Promise<Map<string, ScryfallCard>> {
        const found = new Map<string, ScryfallCard>();
        for (let i = 0; i < cards.length; i += MAX_COLLECTION) {
            const chunk = cards.slice(i, i + MAX_COLLECTION);
            try {
                const { data } = await this.fetchJson<{
                    data?: ScryfallCard[];
                }>(
                    this.collectionClient.url('/cards/collection'),
                    {
                        method: 'POST',
                        signal,
                        headers: {
                            ...HEADERS,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            identifiers: chunk.map((name) => ({ name }))
                        })
                    },
                    this.collectionClient
                );
                for (const card of data ?? [])
                    for (const name of [
                        card.name,
                        ...(card.card_faces?.map((f) => f.name) ?? [])
                    ])
                        found.set(normalize(name), card);
            } catch (err) {
                if (signal?.aborted) throw err;
                if (err instanceof LookupsPaused) continue;
                logger.warn(
                    'bulk name lookup failed, looking names up one by one',
                    {
                        count: chunk.length,
                        error: err
                    }
                );
            }
        }
        return found;
    }

    private remember(key: string, name: ResolvedName) {
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

function scryfallClient() {
    return new ShopClient('https://api.scryfall.com', {
        intervalMs: 500,
        timeoutMs: 5_000,
        maxWaitMs: 5_000
    });
}
