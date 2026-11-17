import { normalize } from '../../matching';
import type { StoredCard } from '../db/list-store';
import type { CardPrice, PriceCache } from '../db/price-cache';
import { SCRYFALL_HEADERS } from '../name-resolver';
import { toPrice } from '../parsers/helpers';
import { HttpError, type ShopClient } from '../shop-client';
import type { Finish, ListCard } from './list-card';
import { ListRefreshFailure } from './list-reader';

// Identifiers per POST /cards/collection, Scryfall's maximum.
const MAX_COLLECTION = 75;

// The collection client is shared with live name lookups (2 requests a second), so a big list leaves a gap
// between its requests and searches' lookups don't queue behind a run of them.
const PAUSE_MS = 1_000;

// What Scryfall is asked for a row, as precisely as the list names the printing:
//   {id}          ManaBox rows (their Scryfall id): the exact printing
//   {name, set}   MTGGoldfish rows with [SET]: that set's printing, which may not be the row's variant
//   {name}        rows without a set (or one Scryfall doesn't know): Scryfall's default printing
//   promo         MTGGoldfish promos ([PRM-…], no set): every printing searched, the one its words name (pickPromo)
// The first three go to /cards/collection in batches; a promo is a /cards/search of its own.
// `key` is the PriceCache key for the answer.
type Identifier = { id: string } | { name: string; set?: string };
type Promo = { name: string; words: string[] };
type Ask = { key: string; exact: boolean } & (
    { identifier: Identifier } | { promo: Promo }
);

// The fields read from Scryfall's answer:
//   {"object":"list","not_found":[{"name":"Lotus Bloom","set":"prm"}],
//    "data":[{"id":"…","name":"Sol Ring","set":"c21","prices":{"usd":"1.50","usd_foil":null,"usd_etched":null},
//             "image_uris":{"normal":"https://cards.scryfall.io/normal/front/…"}}]}
// Double-faced cards have their images on the faces: "card_faces":[{"name":"…","image_uris":{"normal":"…"}}, …].
type Printing = {
    id?: string;
    name?: string;
    set?: string;
    prices?: { usd?: unknown; usd_foil?: unknown; usd_etched?: unknown };
    image_uris?: { normal?: string };
    card_faces?: { name?: string; image_uris?: { normal?: string } }[];
    set_name?: string; // /cards/search, for promos: "Store Championships"
    promo_types?: string[]; // likewise: ["storechampionship"]
};

// MTGGoldfish's promo groups, in the words Scryfall uses for them (set names, promo types). Groups not here
// ("MSC", misc) have only the row's <…> to go by.
const PROMO_GROUPS: Record<string, string[]> = {
    PRE: ['prerelease'],
    FNM: ['fnm'],
    GDP: ['gameday'],
    BAB: ['buyabox'],
    WPN: ['wizardsplaynetwork'],
    OHP: ['openhouse'],
    MPR: ['player', 'reward'],
    WMCQ: ['wmcq']
};

// Words too common in set names to tell printings apart.
const STOP_WORDS = new Set(['the', 'of', 'and', 'magic', 'promo']);

// "DFT Store Championships" → ["dft", "store", "championship"]: lower-case, plurals without their "s".
const words = (text: string) =>
    normalize(text)
        .split(/[^a-z0-9]+/)
        .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
        .filter((w) => w && !STOP_WORDS.has(w));

// Cached for a row Scryfall doesn't have, so it isn't asked again every day.
const NOT_FOUND: CardPrice = {
    usd: null,
    usdFoil: null,
    usdEtched: null,
    scryfallId: null,
    image: null
};

const PRICE_OF: Record<Finish, keyof CardPrice> = {
    nonfoil: 'usd',
    foil: 'usdFoil',
    etched: 'usdEtched'
};

// Scryfall finds a double-faced or split card by one face's name, never by the whole "A // B" (its not_found
// for {"name":"Fire // Ice"}), so it's asked for the front face. The answer's printing still names the whole card.
const faceName = (name: string) => name.split(' // ')[0]!;

const byName = (name: string): Ask => ({
    key: `name:${normalize(name)}`,
    identifier: { name: faceName(name) },
    exact: false
});

function askFor(card: ListCard): Ask {
    if (card.promo) {
        const named =
            card.variant && card.variant !== 'promo' ? words(card.variant) : [];
        return {
            key: `promo:${card.promo}/${named.join(' ')}/${normalize(card.name)}`,
            promo: {
                name: faceName(card.name),
                words: [...named, ...(PROMO_GROUPS[card.promo] ?? [])]
            },
            exact: true
        };
    }
    if (card.scryfallId)
        return {
            key: `id:${card.scryfallId}`,
            identifier: { id: card.scryfallId },
            exact: true
        };
    if (card.set)
        return {
            key: `set:${card.set}/${normalize(card.name)}`,
            identifier: { name: faceName(card.name), set: card.set },
            // a variant ("retro", "borderless") is another printing in the same set, with its own price
            exact: !card.variant
        };
    return byName(card.name);
}

// Prices the rows of a list that came without one (MTGGoldfish's, or a ManaBox row the app has no price for), from
// Scryfall in USD for the row's finish. Prices are cached for a day, so lists that share cards share requests.
export class ListPrices {
    constructor(
        private readonly client: ShopClient, // the name resolver's /cards/collection client
        private readonly cache: PriceCache,
        private readonly pauseMs = PAUSE_MS,
        private readonly sleep = (ms: number) => Bun.sleep(ms)
    ) {}

    // Throws ListRefreshFailure('unavailable') when Scryfall doesn't answer: the refresh is tried again later,
    // rather than storing a list with its prices missing for a day.
    async price(
        cards: ListCard[],
        now = Date.now(),
        signal?: AbortSignal
    ): Promise<StoredCard[]> {
        const asks = new Map<ListCard, Ask>();
        for (const card of cards)
            if (card.usd === undefined) asks.set(card, askFor(card));
        const found = await this.lookup([...asks.values()], now, signal);

        // a set Scryfall doesn't know by that code (MTGGoldfish spells a few differently), or a promo its words
        // don't single out: by name alone instead
        const fallbacks = new Map<ListCard, Ask>();
        for (const [card, ask] of asks)
            if (
                ('promo' in ask || 'set' in ask.identifier) &&
                !found.get(ask.key)?.scryfallId
            )
                fallbacks.set(card, byName(card.name));
        const byNames = await this.lookup([...fallbacks.values()], now, signal);

        return cards.map((card) => {
            const fallback = fallbacks.get(card);
            const ask = fallback ?? asks.get(card);
            if (!ask) return card;
            const price = (fallback ? byNames : found).get(ask.key)!;
            const usd = price[PRICE_OF[card.finish]] as number | null;
            return {
                ...card,
                ...(usd !== null && { usd }),
                ...(!card.image && price.image && { image: price.image }),
                ...(!card.scryfallId &&
                    price.scryfallId && { scryfallId: price.scryfallId }),
                approxPrice: !ask.exact
            };
        });
    }

    // Drops cached prices too old to use.
    purge(now = Date.now()) {
        this.cache.purge(now);
    }

    // Every ask's price: from the cache, else from Scryfall (and then cached), else NOT_FOUND.
    private async lookup(
        asks: Ask[],
        now: number,
        signal?: AbortSignal
    ): Promise<Map<string, CardPrice>> {
        const prices = this.cache.get(
            asks.map((a) => a.key),
            now
        );
        const missing = [
            ...new Map(
                asks.filter((a) => !prices.has(a.key)).map((a) => [a.key, a])
            ).values()
        ];
        // collection batches first, then a search per promo, with a pause before each request but the first
        const batched = missing.flatMap((a) => ('identifier' in a ? [a] : []));
        const requests: (() => Promise<Map<string, CardPrice>>)[] = [];
        for (let i = 0; i < batched.length; i += MAX_COLLECTION) {
            const chunk = batched.slice(i, i + MAX_COLLECTION);
            requests.push(() => this.fetchChunk(chunk, signal));
        }
        for (const ask of missing)
            if ('promo' in ask)
                requests.push(() => this.searchPromo(ask, ask.promo, signal));
        for (const [i, request] of requests.entries()) {
            if (i > 0) await this.sleep(this.pauseMs);
            const fetched = await request();
            this.cache.set(fetched, now);
            for (const [key, price] of fetched) prices.set(key, price);
        }
        return prices;
    }

    // Every paper printing of the card, from which pickPromo takes the one the row names. A card Scryfall doesn't
    // know is a 404, which is an answer: no printing.
    private async searchPromo(
        ask: Ask,
        promo: Promo,
        signal?: AbortSignal
    ): Promise<Map<string, CardPrice>> {
        let data: Printing[];
        try {
            const answer = await this.client.fetchJson<{ data?: unknown }>(
                this.client.url('/cards/search', {
                    q: `!"${promo.name}" game:paper`,
                    unique: 'prints'
                }),
                { signal, headers: SCRYFALL_HEADERS }
            );
            data = Array.isArray(answer?.data) ? answer.data : [];
        } catch (err) {
            if (!(err instanceof HttpError && err.status === 404))
                throw new ListRefreshFailure('unavailable', { cause: err });
            data = [];
        }
        const printing = pickPromo(data, promo.words);
        return new Map([[ask.key, printing ? priceOf(printing) : NOT_FOUND]]);
    }

    private async fetchChunk(
        chunk: (Ask & { identifier: Identifier })[],
        signal?: AbortSignal
    ): Promise<Map<string, CardPrice>> {
        let data: Printing[];
        try {
            const answer = await this.client.fetchJson<{ data?: unknown }>(
                this.client.url('/cards/collection'),
                {
                    method: 'POST',
                    signal,
                    headers: {
                        ...SCRYFALL_HEADERS,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        identifiers: chunk.map((a) => a.identifier)
                    })
                }
            );
            data = Array.isArray(answer?.data) ? answer.data : [];
        } catch (err) {
            throw new ListRefreshFailure('unavailable', { cause: err });
        }
        // Scryfall answers in the order asked, leaving out what it didn't find; each ask takes the first printing
        // left that fits it, which keeps two asks for one name ({name} and {name, set}) apart.
        const left = new Set(data);
        const prices = new Map<string, CardPrice>();
        for (const ask of chunk) {
            const printing = [...left].find((p) => fits(p, ask.identifier));
            if (printing) left.delete(printing);
            prices.set(ask.key, printing ? priceOf(printing) : NOT_FOUND);
        }
        return prices;
    }
}

// The printing a promo row names: the one whose set name, promo types and set code share the most of its words
// ("Store Championship" → "Store Championships", ["storechampionship"]), when only one does best. A row with no
// words to go by is that printing only when the card has a single promo.
export function pickPromo(
    printings: Printing[],
    named: string[]
): Printing | null {
    if (named.length === 0) {
        const promos = printings.filter((p) => p.promo_types?.length);
        return promos.length === 1 ? promos[0]! : null;
    }
    const joined = named.join('');
    const score = (p: Printing) => {
        const types = p.promo_types ?? [];
        const own = new Set([
            ...words(p.set_name ?? ''),
            ...types,
            p.set ?? ''
        ]);
        return (
            named.filter((w) => own.has(w)).length +
            (types.includes(joined) ? 1 : 0)
        );
    };
    const scores = printings.map(score);
    const best = Math.max(0, ...scores);
    const top = printings.filter((_, i) => scores[i] === best);
    return best > 0 && top.length === 1 ? top[0]! : null;
}

function fits(printing: Printing, identifier: Identifier) {
    if ('id' in identifier) return printing.id === identifier.id;
    if (identifier.set !== undefined && printing.set !== identifier.set)
        return false;
    const names = [
        printing.name,
        ...(printing.card_faces ?? []).map((f) => f.name)
    ];
    return names.some(
        (n) =>
            typeof n === 'string' && normalize(n) === normalize(identifier.name)
    );
}

function priceOf(p: Printing): CardPrice {
    return {
        usd: toPrice(p.prices?.usd),
        usdFoil: toPrice(p.prices?.usd_foil),
        usdEtched: toPrice(p.prices?.usd_etched),
        scryfallId: typeof p.id === 'string' ? p.id : null,
        image:
            p.image_uris?.normal ??
            p.card_faces?.[0]?.image_uris?.normal ??
            null
    };
}
