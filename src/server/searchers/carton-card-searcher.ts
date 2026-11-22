import { parseCarton, type CartonProduct } from '@/server/parsers/api/carton';
import { isExactMatch } from '@/shared/matching';
import type { CardResult } from '@/shared/search-result';
import { warnFallback, type CardSearcher } from '@/server/search/card-searcher';
import { ShopClient, ShopRequestError } from '@/server/outbound/shop-client';

// CartOn's GraphQL API scores each query and refuses any over 500. Every field counts 1; in `products(first: P)`
// each product's fields count P times, and inside a product's `offers(first: O)` everything, `nodes` included,
// counts O times more. So a search page costs 5 + P × (7 + 6 × O): 13 products × 5 offers → 486.
// Most printings have one or two offers, so a page holds many products with a few offers each.
export const PRODUCTS_PER_PAGE = 13;
export const OFFERS_PER_PRODUCT = 5;

// The search matches anywhere in the name ("Opt" finds 22 products, Thopters and Optimistic Scavengers among them),
// in no useful order, so a short name's printings can sit a few pages in. Up to this many pages are read.
export const MAX_SEARCH_PAGES = 4;

// An exact printing that fills its OFFERS_PER_PRODUCT may have more, so its offers are fetched again, up to
// ALL_OFFERS (2 + 2 × (2 + 6 × 40) = 486), for at most MAX_OFFER_PAGES printings per search.
export const ALL_OFFERS = 40;
export const MAX_OFFER_PAGES = 5;

const MAGIC_SINGLES =
    'universeSlug: "magic-the-gathering", productTypeSlug: "singles"';
const OFFER_FIELDS = 'amount price attributes { key value }';

export const SEARCH_QUERY = `query ($search: String!, $after: String) {
    products(search: $search, ${MAGIC_SINGLES}, first: ${PRODUCTS_PER_PAGE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
            name url imageUrl expansion { name slug }
            offers(first: ${OFFERS_PER_PRODUCT}) { nodes { ${OFFER_FIELDS} } }
        }
    }
}`;

// One printing's offers: there's no query for a product by id, so it's searched by its own name within its set.
const OFFERS_QUERY = `query ($search: String!, $expansion: String!) {
    products(search: $search, ${MAGIC_SINGLES}, expansionSlug: $expansion, first: 2) {
        nodes { url offers(first: ${ALL_OFFERS}) { nodes { ${OFFER_FIELDS} } } }
    }
}`;

type Products = {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: (CartonProduct | null)[];
};

const nodes = (found: Products | undefined) =>
    (found?.nodes ?? []).filter((p): p is CartonProduct => p != null);

// CartOn's partner API (POST /graphql), with a key (CARTON_API_KEY, sent as a bearer token). Each search lists the
// printings in stock with their offers, so no product pages are fetched. The key allows 120 requests a minute,
// shared by every user: the client spaces requests 500 ms apart, which can't exceed it.
export class CartonCardSearcher implements CardSearcher {
    readonly shop = 'carton';

    constructor(
        private readonly client = new ShopClient('https://carton.cards', {
            intervalMs: 500
        }),
        private readonly apiKey = process.env.CARTON_API_KEY
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        if (!this.apiKey) throw new Error('CARTON_API_KEY is not set');
        const products: CartonProduct[] = [];
        let after: string | null = null;
        for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
            let found: Products | undefined;
            try {
                found = await this.query(
                    SEARCH_QUERY,
                    { search: card, after },
                    signal
                );
            } catch (err) {
                if (page === 0) throw err;
                warnFallback(
                    this.shop,
                    this.client.url('/graphql'),
                    err,
                    signal
                );
                break;
            }
            products.push(...nodes(found));
            const next = found?.pageInfo;
            if (!next?.hasNextPage || !next.endCursor) break;
            after = next.endCursor;
        }
        await this.fetchAllOffers(card, products, signal);
        return parseCarton(products);
    }

    // Swaps the first page of offers for all of them on the exact printings that filled it. Fuzzy "other matches"
    // keep their first page. A failed request keeps it too.
    private async fetchAllOffers(
        card: string,
        products: CartonProduct[],
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
                    const found = await this.query(
                        OFFERS_QUERY,
                        {
                            search: product.name,
                            expansion: product.expansion!.slug
                        },
                        signal
                    );
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

    private async query(
        query: string,
        variables: Record<string, unknown>,
        signal?: AbortSignal
    ): Promise<Products | undefined> {
        const url = this.client.url('/graphql');
        const json = await this.client.fetchJson<{
            data?: { products?: Products } | null;
            errors?: unknown[];
        }>(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query, variables }),
            signal
        });
        // GraphQL answers a refused query (too complex, a bad cursor) with a 200 and `errors`
        if (json?.errors?.length)
            throw new ShopRequestError('API error', {
                url,
                method: 'POST',
                body: JSON.stringify(json.errors).slice(0, 500)
            });
        return json?.data?.products;
    }
}
