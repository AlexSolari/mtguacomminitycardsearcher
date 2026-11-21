// How a card's offers are grouped and priced, for the result sections and the summary. Browser-only, pure.
import { isArtSeries, isExactMatch, normalize } from './matching';
import type { CardResult, SearchResult } from './search-result';

// React key for an offer. The URL alone isn't unique: Nerdik lists one printing's offers at different
// prices, and CartOn's offers of different conditions or languages, all sharing the printing's URL. A trader's
// offers all share their Telegram link; the list and printing tell them apart.
export const offerKey = (l: CardResult) =>
    `${l.url}|${l.price}|${l.foil}|${l.language}|${l.condition}` +
    (l.seller ? `|${l.seller.list}|${l.name}|${l.seller.printing}` : '');

// A trader's price in UAH: Scryfall's USD price at their rate, to the hryvnia; null without either.
export const sellerUah = (l: CardResult): number | null =>
    l.usdPrice !== undefined && l.usdRate !== undefined
        ? Math.round(l.usdPrice * l.usdRate)
        : null;

const byPrice = (a: CardResult, b: CardResult) =>
    (a.price ?? Infinity) - (b.price ?? Infinity);
const byUsdPrice = (a: CardResult, b: CardResult) =>
    (a.usdPrice ?? Infinity) - (b.usdPrice ?? Infinity);
const minPrice = (links: CardResult[]) =>
    links.reduce<number | null>(
        (min, l) =>
            l.price !== null && (min === null || l.price < min) ? l.price : min,
        null
    );

// Groups, each sorted by price: exact matches → auctions → traders → other (fuzzy) matches → Art Series.
// A card's "best price" / "from" use the first non-empty of exact → other → art, so neither "School Daze"
// (for "Daze") nor a 16 ₴ Art Series card (for "Sol Ring") wins "Best price". Auction bids aren't fixed
// prices, so auctions never count toward pricing; nor do traders' offers, priced from Scryfall in USD.
// A result object never changes (a streamed card gets a new object per update), so the split is computed once per result object and shared by
// CardSection and SearchSummary.
export type Split = {
    exact: CardResult[];
    auctions: CardResult[];
    traders: CardResult[]; // by USD price
    art: CardResult[];
    other: CardResult[];
    pricing: Set<CardResult>;
    min: number | null;
    // The "best price" badge: the cheapest of `pricing`, only when it has two priced offers or more. A lone offer has
    // nothing to beat; auctions, traders and the groups that don't set the price aren't competitors.
    best: Set<CardResult>;
};
const splits = new WeakMap<SearchResult, Split>();
export function splitMatches(r: SearchResult): Split {
    let split = splits.get(r);
    if (split) return split;

    const exact: CardResult[] = [];
    const auctions: CardResult[] = [];
    const traders: CardResult[] = [];
    const art: CardResult[] = [];
    const other: CardResult[] = [];
    for (const l of r.links) {
        if (l.shop === 'traders') traders.push(l);
        else if (l.auction) auctions.push(l);
        else if (isArtSeries(l)) art.push(l);
        else if (isExactMatch(l.name, r.card)) exact.push(l);
        else other.push(l);
    }
    for (const group of [exact, auctions, art, other]) group.sort(byPrice);
    traders.sort(byUsdPrice);
    const pricing = exact.length > 0 ? exact : other.length > 0 ? other : art;
    const min = minPrice(pricing);
    const priced = pricing.filter((l) => l.price !== null);

    split = {
        exact,
        auctions,
        traders,
        art,
        other,
        pricing: new Set(pricing),
        min,
        best: new Set(
            priced.length > 1 ? priced.filter((l) => l.price === min) : []
        )
    };
    splits.set(r, split);
    return split;
}

// The cheapest way to buy `count` copies from `offers` (sorted by price): fill from the cheapest offer up, each
// up to its stock. Offers without a stock figure count as plenty; offers without a price are skipped.
// "від" prices count as-is, so the cost is a lower bound. `copies < count` = the shops don't have enough.
export function cheapestCopies(offers: CardResult[], count: number) {
    const { cost, copies } = allocateCopies(offers, count);
    return { cost, copies };
}

// A list's entries with those for the same card merged, their counts added up. Two lines can name one card
// ("Bonecrusher Giant" and "Bonecrusher Giant // Stomp" both resolve to it), and buying for each on its own would
// count the same copies twice. An entry is keyed by the card its search found, or its name as typed until then. The
// merged entry keeps the first one's fields and result, unless that result is still pending and a later one isn't
// (they're the same card's offers either way). Entries keep their order, at their first line.
export function mergeSameCard<
    T extends { card: string; count: number; result: SearchResult | null }
>(entries: T[]): T[] {
    const merged = new Map<string, T>();
    for (const e of entries) {
        const key = normalize(e.result?.card ?? e.card);
        const seen = merged.get(key);
        if (!seen) {
            merged.set(key, e);
            continue;
        }
        const pending = (r: SearchResult | null) => !!r?.pending?.length;
        merged.set(key, {
            ...seen,
            count: seen.count + e.count,
            result:
                pending(seen.result) && !pending(e.result)
                    ? e.result
                    : seen.result
        });
    }
    return [...merged.values()];
}

// cheapestCopies, with which offers it took and how many of each (for the order plan).
export function allocateCopies(offers: CardResult[], count: number) {
    let cost = 0;
    let copies = 0;
    const picks: { offer: CardResult; qty: number }[] = [];
    for (const o of offers) {
        if (copies >= count) break;
        if (o.price === null) continue;
        const take = Math.min(count - copies, o.stock ?? Infinity);
        cost += take * o.price;
        copies += take;
        picks.push({ offer: o, qty: take });
    }
    return { cost, copies, picks };
}

// Nothing to show for the card: no offers, no shop failed (a failure shows a "check manually" tile), and no shop
// still searching.
export const isNotFound = (r: SearchResult) =>
    r.links.length === 0 && r.errors.length === 0 && !r.pending?.length;
