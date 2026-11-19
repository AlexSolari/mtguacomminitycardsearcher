// How a card's offers are grouped and priced, for the result sections and the summary. Browser-only, pure.
import { isArtSeries, isExactMatch } from './matching';
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

    split = {
        exact,
        auctions,
        traders,
        art,
        other,
        pricing: new Set(pricing),
        min: minPrice(pricing)
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
