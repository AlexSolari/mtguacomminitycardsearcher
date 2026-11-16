import { normalize } from '../../matching';
import type { StoredCard } from '../db/list-store';
import type { CardPrice, PriceCache } from '../db/price-cache';
import { SCRYFALL_HEADERS } from '../name-resolver';
import { toPrice } from '../parsers/helpers';
import type { ShopClient } from '../shop-client';
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
// `key` is the PriceCache key for the answer.
type Identifier = { id: string } | { name: string; set?: string };
type Ask = { key: string; identifier: Identifier; exact: boolean };

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
};

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

        // a set Scryfall doesn't know by that code (MTGGoldfish spells a few differently): by name alone instead
        const fallbacks = new Map<ListCard, Ask>();
        for (const [card, ask] of asks)
            if ('set' in ask.identifier && !found.get(ask.key)?.scryfallId)
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
        for (let i = 0; i < missing.length; i += MAX_COLLECTION) {
            if (i > 0) await this.sleep(this.pauseMs);
            const chunk = missing.slice(i, i + MAX_COLLECTION);
            const fetched = await this.fetchChunk(chunk, signal);
            this.cache.set(fetched, now);
            for (const [key, price] of fetched) prices.set(key, price);
        }
        return prices;
    }

    private async fetchChunk(
        chunk: Ask[],
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
