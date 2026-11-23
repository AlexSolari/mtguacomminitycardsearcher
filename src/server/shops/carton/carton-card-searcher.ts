import {
    parseCarton,
    type CartonProduct
} from '@/server/shops/carton/carton-parser';
import { isExactMatch } from '@/shared/matching';
import type { CardResult } from '@/shared/search-result';
import { Batcher, BATCH_WINDOW_MS } from '@/server/outbound/batcher';
import { warnFallback, type CardSearcher } from '@/server/search/card-searcher';
import { ShopClient, ShopRequestError } from '@/server/outbound/shop-client';

// CartOn's GraphQL API scores each query and refuses any over MAX_COMPLEXITY. The score counts the whole query, so
// several lookups share a request as aliases (`c0: products(…) c1: products(…)`) while their scores add up to no
// more. Every field counts 1; in `products(first: P)` each product's fields count P times, and inside a product's
// `offers(first: O)` everything, `nodes` included, counts O times more (see `complexity`).
export const MAX_COMPLEXITY = 500;

// Most cards have few printings in stock, with an offer or two each (of a 22-card deck sampled in November 2026, 10
// had none, only Island had more than 6, and no printing had more than 2 offers). So a search starts small:
// 5 + 3 × (7 + 6 × 3) = 80, six cards to a request.
export const FIRST_PAGE_PRODUCTS = 3;
export const OFFERS_PER_PRODUCT = 3;

// A card with more printings reads on in larger pages: 5 + 16 × 25 = 405, which leaves room for a first page.
// The search matches anywhere in the name ("Opt" finds 22 products, Thopters among them), in no useful order, so a
// short name's printings can sit a few pages in. Up to MAX_SEARCH_PAGES pages are read: 3 + 3 × 16 = 51 products.
export const NEXT_PAGE_PRODUCTS = 16;
export const MAX_SEARCH_PAGES = 4;

// An exact printing that fills its OFFERS_PER_PRODUCT may have more, so its offers are fetched again, up to
// ALL_OFFERS (2 + 2 × (2 + 6 × 40) = 486), for at most MAX_OFFER_PAGES printings per search.
export const ALL_OFFERS = 40;
export const MAX_OFFER_PAGES = 5;

// One alias in a batched query: a page of a card's search, or one printing's offers. There's no query for a
// product by id, so a printing is searched by its own name within its set.
export type CartonLookup =
    | { search: string; after: string | null; first: number }
    | { search: string; expansion: string };

// The lookup's score as CartOn counts it (checked against the API: two 486s in one query are refused as 972).
// A search page: products, pageInfo, hasNextPage, endCursor, nodes; per product name, url, imageUrl, expansion,
// its name and slug, offers; per offer nodes, amount, price, attributes, key, value.
// A printing's offers: products, nodes; per product url, offers; per offer the same 6.
export const complexity = (lookup: CartonLookup) =>
    'expansion' in lookup
        ? 2 + 2 * (2 + 6 * ALL_OFFERS)
        : 5 + lookup.first * (7 + 6 * OFFERS_PER_PRODUCT);

const MAGIC_SINGLES =
    'universeSlug: "magic-the-gathering", productTypeSlug: "singles"';
const OFFER_FIELDS = 'amount price attributes { key value }';

// Lookup i is the alias `c{i}`, with its own variables (`s{i}` its search, `a{i}` a page's cursor, `e{i}` a
// printing's set), so names never go into the query text.
export function cartonQuery(lookups: CartonLookup[]) {
    const params: string[] = [];
    const fields: string[] = [];
    const variables: Record<string, string | null> = {};
    lookups.forEach((lookup, i) => {
        params.push(`$s${i}: String!`);
        variables[`s${i}`] = lookup.search;
        if ('expansion' in lookup) {
            params.push(`$e${i}: String!`);
            variables[`e${i}`] = lookup.expansion;
            fields.push(`c${i}: products(search: $s${i}, ${MAGIC_SINGLES}, expansionSlug: $e${i}, first: 2) {
        nodes { url offers(first: ${ALL_OFFERS}) { nodes { ${OFFER_FIELDS} } } }
    }`);
        } else {
            params.push(`$a${i}: String`);
            variables[`a${i}`] = lookup.after;
            fields.push(`c${i}: products(search: $s${i}, ${MAGIC_SINGLES}, first: ${lookup.first}, after: $a${i}) {
        pageInfo { hasNextPage endCursor }
        nodes {
            name url imageUrl expansion { name slug }
            offers(first: ${OFFERS_PER_PRODUCT}) { nodes { ${OFFER_FIELDS} } }
        }
    }`);
        }
    });
    return {
        query: `query (${params.join(', ')}) {\n    ${fields.join('\n    ')}\n}`,
        variables
    };
}

export type Products = {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: (CartonProduct | null)[];
};

type GraphqlError = { path?: unknown[] };

const nodes = (found: Products | undefined) =>
    (found?.nodes ?? []).filter((p): p is CartonProduct => p != null);

// CartOn's partner API (POST /graphql), with a key (CARTON_API_KEY, sent as a bearer token). Each search lists the
// printings in stock with their offers, so no product pages are fetched. The key allows 120 requests a minute,
// shared by every user: the client spaces requests 500 ms apart, which can't exceed it, and lookups are batched
// (see Batcher), as many to a request as MAX_COMPLEXITY allows. A card's next pages and full offer lists join
// whatever batch goes next, with other cards' lookups.
export class CartonCardSearcher implements CardSearcher {
    readonly shop = 'carton';
    readonly batched = true;
    private readonly batcher = new Batcher<CartonLookup, Products | undefined>(
        (lookups, signal) => this.send(lookups, signal),
        MAX_COMPLEXITY,
        BATCH_WINDOW_MS,
        complexity
    );

    constructor(
        private readonly client = new ShopClient('https://carton.cards', {
            intervalMs: 500
        }),
        private readonly apiKey = process.env.CARTON_API_KEY
    ) {}

    async search(
        card: string,
        signal?: AbortSignal,
        _fullName?: string,
        urgent = false
    ): Promise<CardResult[]> {
        if (!this.apiKey) throw new Error('CARTON_API_KEY is not set');
        const lookup = (l: CartonLookup) => this.batcher.add(l, signal, urgent);
        let found = await lookup({
            search: card,
            after: null,
            first: FIRST_PAGE_PRODUCTS
        });
        const products = nodes(found);
        for (let page = 1; page < MAX_SEARCH_PAGES; page++) {
            const next = found?.pageInfo;
            if (!next?.hasNextPage || !next.endCursor) break;
            try {
                found = await lookup({
                    search: card,
                    after: next.endCursor,
                    first: NEXT_PAGE_PRODUCTS
                });
            } catch (err) {
                warnFallback(
                    this.shop,
                    this.client.url('/graphql'),
                    err,
                    signal
                );
                break;
            }
            products.push(...nodes(found));
        }
        await this.fetchAllOffers(card, products, lookup, signal);
        return parseCarton(products);
    }

    // Swaps the first page of offers for all of them on the exact printings that filled it. Fuzzy "other matches"
    // keep their first page. A failed request keeps it too.
    private async fetchAllOffers(
        card: string,
        products: CartonProduct[],
        lookup: (l: CartonLookup) => Promise<Products | undefined>,
        signal?: AbortSignal
    ) {
        const full = products
            .filter(
                (p) =>
                    p.name &&
                    p.expansion?.slug &&
                    isExactMatch(p.name, card) &&
                    (p.offers?.nodes?.length ?? 0) >= OFFERS_PER_PRODUCT
            )
            .slice(0, MAX_OFFER_PAGES);
        await Promise.all(
            full.map(async (product) => {
                try {
                    const found = await lookup({
                        search: product.name!,
                        expansion: product.expansion!.slug!
                    });
                    const same = nodes(found).find(
                        (p) => p.url === product.url
                    );
                    if (same?.offers?.nodes?.length)
                        product.offers = same.offers;
                } catch (err) {
                    warnFallback(this.shop, product.url!, err, signal);
                }
            })
        );
    }

    // One answer per lookup, from its alias. GraphQL answers a refused query (too complex, malformed) with a 200 and
    // `errors` that name no alias: that fails every lookup in it. An error inside one alias (a bad cursor) names it
    // in its `path` and fails only that lookup.
    private async send(lookups: CartonLookup[], signal: AbortSignal) {
        const url = this.client.url('/graphql');
        const json = await this.client.fetchJson<{
            data?: Record<string, Products | null> | null;
            errors?: GraphqlError[];
        }>(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(cartonQuery(lookups)),
            signal
        });
        const failure = (errors: unknown[]) =>
            new ShopRequestError('API error', {
                url,
                method: 'POST',
                body: JSON.stringify(errors).slice(0, 500)
            });
        const aliases = lookups.map((_, i) => `c${i}`);
        const errors = Array.isArray(json?.errors) ? json.errors : [];
        const aliasOf = (e: GraphqlError | null) => e?.path?.[0];
        if (
            errors.length > 0 &&
            (!json?.data ||
                errors.some((e) => !aliases.includes(aliasOf(e) as string)))
        )
            throw failure(errors);
        return aliases.map((alias) => {
            const own = errors.filter((e) => aliasOf(e) === alias);
            return own.length > 0
                ? failure(own)
                : (json?.data?.[alias] ?? undefined);
        });
    }
}
