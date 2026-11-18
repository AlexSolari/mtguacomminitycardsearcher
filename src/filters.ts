// The results' filters: finish, language and shop. Browser-only, pure. They run on the results the server sent,
// so changing them never searches again.
import type { CardResult, SearchResult } from './search-result';
import { SHOP_INFO, type ShopId } from './shops';

export type FoilFilter = 'any' | 'nonfoil' | 'foil';

export type OfferFilters = {
    foil: FoilFilter;
    // Hidden rather than shown, so a shop added later, or a language a later search first finds, shows by default.
    hiddenLanguages: string[]; // upper-case codes
    hiddenShops: ShopId[];
};

export const NO_FILTERS: OfferFilters = {
    foil: 'any',
    hiddenLanguages: [],
    hiddenShops: []
};

export const isFiltering = (f: OfferFilters) =>
    f.foil !== 'any' ||
    f.hiddenLanguages.length > 0 ||
    f.hiddenShops.length > 0;

// An offer that doesn't say passes the filter on that detail: Kartoteka and traders' lists give no language,
// and several shops leave `foil` out on regular cards, so "unknown" counts as non-foil and as any language.
// Hiding them would drop whole shops from a filtered search without saying why.
export function offerPasses(l: CardResult, f: OfferFilters) {
    if (f.foil === 'foil' && !l.foil) return false;
    if (f.foil === 'nonfoil' && l.foil) return false;
    if (l.language && f.hiddenLanguages.includes(l.language)) return false;
    return !f.hiddenShops.includes(l.shop);
}

// The result with only the offers that pass, and without the hidden shops' errors (no "check manually" tile for a
// shop the user hid) and pending searches. One object per result and filters, reused while neither changes:
// CardSection is memoized on it and splitMatches caches per result object.
const filtered = new WeakMap<
    SearchResult,
    { key: string; value: SearchResult }
>();
export function filterResult(r: SearchResult, f: OfferFilters): SearchResult {
    if (!isFiltering(f)) return r;
    const key = JSON.stringify(f);
    const cached = filtered.get(r);
    if (cached?.key === key) return cached.value;

    const shown = (shop?: ShopId) => !shop || !f.hiddenShops.includes(shop);
    const value: SearchResult = {
        ...r,
        links: r.links.filter((l) => offerPasses(l, f)),
        errors: r.errors.filter((e) => shown(e.shop))
    };
    if (r.pending) value.pending = r.pending.filter(shown);
    filtered.set(r, { key, value });
    return value;
}

// The languages the results have, most offers first, for the language menu.
export function languageCounts(results: SearchResult[]) {
    const counts = new Map<string, number>();
    for (const r of results)
        for (const l of r.links)
            if (l.language)
                counts.set(l.language, (counts.get(l.language) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// Offers per shop, in the registry's order, every shop included (0 when it found nothing).
export function shopCounts(results: SearchResult[]) {
    const counts = new Map<ShopId, number>(
        (Object.keys(SHOP_INFO) as ShopId[]).map((s) => [s, 0])
    );
    for (const r of results)
        for (const l of r.links) counts.set(l.shop, counts.get(l.shop)! + 1);
    return [...counts];
}

// Filters saved by an older version, edited by hand or corrupted: anything unrecognised falls back to no filter.
export function parseFilters(raw: string | null): OfferFilters {
    let v: any;
    try {
        v = JSON.parse(raw ?? '');
    } catch {
        return NO_FILTERS;
    }
    if (typeof v !== 'object' || v === null) return NO_FILTERS;
    const strings = (a: unknown): string[] =>
        Array.isArray(a) ? a.filter((s) => typeof s === 'string') : [];
    return {
        foil: ['nonfoil', 'foil'].includes(v.foil) ? v.foil : 'any',
        hiddenLanguages: strings(v.hiddenLanguages).filter((s) =>
            /^[A-Z]{2,3}$/.test(s)
        ),
        hiddenShops: strings(v.hiddenShops).filter((s): s is ShopId =>
            Object.hasOwn(SHOP_INFO, s)
        )
    };
}
