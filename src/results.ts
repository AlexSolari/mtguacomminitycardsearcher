// How a card's offers are grouped and priced, for the result sections and the summary. Browser-only, pure.
import { isArtSeries, isExactMatch } from './matching';
import type { CardResult, SearchResult } from './search-result';

// React key for an offer. The URL alone isn't unique: Nerdik lists one printing's offers at different
// prices, and they all share the printing's URL.
export const offerKey = (l: CardResult) => `${l.url}|${l.price}`;

const byPrice = (a: CardResult, b: CardResult) =>
    (a.price ?? Infinity) - (b.price ?? Infinity);
const minPrice = (links: CardResult[]) =>
    links.reduce<number | null>(
        (min, l) =>
            l.price !== null && (min === null || l.price < min) ? l.price : min,
        null
    );

// Groups, each sorted by price: exact matches → auctions → other (fuzzy) matches → Art Series.
// A card's "best price" / "from" use the first non-empty of exact → other → art, so neither "School Daze"
// (for "Daze") nor a 16 ₴ Art Series card (for "Sol Ring") wins "Best price". Auction bids aren't fixed
// prices, so auctions never count toward pricing.
// A finished result never changes, so the split is computed once per result object and shared by
// CardSection and SearchSummary.
export type Split = {
    exact: CardResult[];
    auctions: CardResult[];
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
    const art: CardResult[] = [];
    const other: CardResult[] = [];
    for (const l of r.links) {
        if (l.auction) auctions.push(l);
        else if (isArtSeries(l)) art.push(l);
        else if (isExactMatch(l.name, r.card)) exact.push(l);
        else other.push(l);
    }
    for (const group of [exact, auctions, art, other]) group.sort(byPrice);
    const pricing = exact.length > 0 ? exact : other.length > 0 ? other : art;

    split = {
        exact,
        auctions,
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
    let cost = 0;
    let copies = 0;
    for (const o of offers) {
        if (copies >= count) break;
        if (o.price === null) continue;
        const take = Math.min(count - copies, o.stock ?? Infinity);
        cost += take * o.price;
        copies += take;
    }
    return { cost, copies };
}
