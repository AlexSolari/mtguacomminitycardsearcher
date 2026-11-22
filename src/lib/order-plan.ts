// The order planner: which shop to buy each card from, for the shops the user would order from. Browser-only, pure.
// No delivery cost yet, so the cheapest plan simply takes each card's cheapest copies; what weighs against spreading
// an order over many shops is shown instead as the best plan for each number of shops (planOptions).
import { allocateCopies, mergeSameCard, splitMatches } from '@/lib/results';
import type { CardResult, SearchResult } from '@/shared/search-result';
import type { ShopId } from '@/shared/shops';

// A card of the list, with what can be bought: its exact matches with a price, cheapest first, as in the summary's
// total (auctions and traders' offers never count).
export type PlanCard = { card: string; count: number; offers: CardResult[] };

// One per card: entries for the same card are merged (mergeSameCard), so its offers' stock is shared out once.
export function planCards(
    entries: { count: number; result: SearchResult | null; card: string }[]
): PlanCard[] {
    return mergeSameCard(entries).map((e) => ({
        card: e.result?.card ?? e.card,
        count: e.count,
        offers: e.result
            ? splitMatches(e.result).exact.filter((o) => o.price !== null)
            : []
    }));
}

export type PlanLine = { card: string; offer: CardResult; qty: number };
export type ShopOrder = {
    shop: ShopId;
    lines: PlanLine[];
    copies: number;
    subtotal: number;
    fromPrice: boolean; // a line's price is a "від" price, so the subtotal is a lower bound
};
export type Plan = {
    shops: ShopOrder[]; // biggest subtotal first
    total: number;
    copies: number;
    wanted: number;
    short: { card: string; copies: number; count: number }[];
};

// The cheapest way to buy the list from `allowed`.
export function planOrder(
    cards: PlanCard[],
    allowed: ReadonlySet<ShopId>
): Plan {
    const orders = new Map<ShopId, ShopOrder>();
    const plan: Plan = { shops: [], total: 0, copies: 0, wanted: 0, short: [] };
    for (const { card, count, offers } of cards) {
        const { cost, copies, picks } = allocateCopies(
            offers.filter((o) => allowed.has(o.shop)),
            count
        );
        plan.total += cost;
        plan.copies += copies;
        plan.wanted += count;
        if (copies < count) plan.short.push({ card, copies, count });
        for (const { offer, qty } of picks) {
            let order = orders.get(offer.shop);
            if (!order)
                orders.set(
                    offer.shop,
                    (order = {
                        shop: offer.shop,
                        lines: [],
                        copies: 0,
                        subtotal: 0,
                        fromPrice: false
                    })
                );
            order.lines.push({ card, offer, qty });
            order.copies += qty;
            order.subtotal += qty * offer.price!;
            order.fromPrice ||= !!offer.fromPrice;
        }
    }
    plan.shops = [...orders.values()].sort((a, b) => b.subtotal - a.subtotal);
    return plan;
}

// Copies and cost of the cheapest plan from `allowed`, and the shops it actually buys from: planOrder without
// building the lines, as planOptions runs it for every combination of shops.
function score(cards: PlanCard[], allowed: ReadonlySet<ShopId>) {
    let copies = 0;
    let total = 0;
    const used = new Set<ShopId>();
    for (const { count, offers } of cards) {
        let got = 0;
        for (const o of offers) {
            if (got >= count) break;
            if (!allowed.has(o.shop)) continue;
            const take = Math.min(count - got, o.stock ?? Infinity);
            total += take * o.price!;
            got += take;
            used.add(o.shop);
        }
        copies += got;
    }
    return { copies, total, used };
}

const better = (
    a: { copies: number; total: number },
    b: { copies: number; total: number }
) => a.copies > b.copies || (a.copies === b.copies && a.total < b.total);

export type PlanOption = { shops: ShopId[]; copies: number; total: number };

// The best plan for each number of shops: more copies first, then the lower total. Every combination of
// `candidates` is tried (at most 2^8 for the shops there are), so each row is the true best for its count. A row is
// kept only if it beats the one before: a fourth shop that saves nothing isn't an option.
export function planOptions(
    cards: PlanCard[],
    candidates: ShopId[]
): PlanOption[] {
    const best: (PlanOption | undefined)[] = [];
    for (let mask = 1; mask < 1 << candidates.length; mask++) {
        const allowed = new Set(candidates.filter((_, i) => mask & (1 << i)));
        const s = score(cards, allowed);
        // judged by the shops it uses: a combination with an idle shop is a smaller one, tried on its own
        if (s.used.size !== allowed.size) continue;
        const k = allowed.size;
        if (!best[k] || better(s, best[k]!))
            best[k] = { shops: [...allowed], copies: s.copies, total: s.total };
    }
    const rows: PlanOption[] = [];
    for (const option of best)
        if (option && (!rows.length || better(option, rows.at(-1)!)))
            rows.push(option);
    return rows;
}

// What leaving `shop` out of `shops` would change: copies lost and the extra cost of buying elsewhere.
export function withoutShop(
    cards: PlanCard[],
    shops: ShopId[],
    shop: ShopId
): { copies: number; total: number } {
    const all = score(cards, new Set(shops));
    const rest = score(cards, new Set(shops.filter((s) => s !== shop)));
    return { copies: all.copies - rest.copies, total: rest.total - all.total };
}

// Shops that have something on the list, in `order`'s order: the planner's candidates.
export const shopsWithOffers = (cards: PlanCard[], order: ShopId[]) =>
    order.filter((s) => cards.some((c) => c.offers.some((o) => o.shop === s)));

// The traders who have cards of the list, the one with the most first: their offers grouped per card.
export type TraderMatch = {
    username: string;
    name: string;
    url: string; // their Telegram
    cards: { card: string; offers: CardResult[] }[];
};
export function traderMatches(
    entries: { count: number; result: SearchResult | null; card: string }[]
): TraderMatch[] {
    const traders = new Map<string, TraderMatch>();
    // each card once, so a card on two lines of the list doesn't list its offers twice
    for (const { result } of mergeSameCard(entries)) {
        if (!result) continue;
        for (const offer of splitMatches(result).traders) {
            const { username, name } = offer.seller!;
            let t = traders.get(username);
            if (!t)
                traders.set(
                    username,
                    (t = { username, name, url: offer.url, cards: [] })
                );
            const last = t.cards.at(-1);
            if (last?.card === result.card) last.offers.push(offer);
            else t.cards.push({ card: result.card, offers: [offer] });
        }
    }
    return [...traders.values()].sort(
        (a, b) =>
            b.cards.length - a.cards.length ||
            a.username.localeCompare(b.username)
    );
}
