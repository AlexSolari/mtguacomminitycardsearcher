import { abs, decodeEntities, languageCode, toPrice } from '../helpers';
import type { CardResult } from '../../../search-result';

// carton.cards is an Inertia.js app: each page's props are JSON in <div id="app" data-page="...">.
function pageProps(html: string): any {
    const raw = html.match(/data-page="([^"]*)"/)?.[1];
    if (!raw) return null;
    try {
        return JSON.parse(decodeEntities(raw))?.props ?? null;
    } catch {
        return null;
    }
}

// Art Series printings are named like the card, so the set or layout tells them apart.
const isArtSeriesSet = (set: any) =>
    set?.layout === 'art_series' || /art_series/.test(set?.set_name ?? '');

// carton.cards/search?q=… — one product per printing in stock, with the cheapest offer's price:
//   {"name":"Counterspell (FDC-61)","url_path":"/magic-the-gathering/singles/…/counterspell-fdc-61-en-v1",
//    "image":"https://storage.carton.cards/…","min_price":146,"language":"EN",
//    "property_set":{"foil":"false","nonfoil":"true","layout":"normal","set_name":"foundations_commander",…}}
export function parseCarton(html: string, base: string): CardResult[] {
    const products: any[] = pageProps(html)?.products ?? [];
    return products.map((p) => ({
        shop: 'carton' as const,
        name: p.name,
        url: abs(base, p.url_path)!,
        image: p.image ?? null,
        price: toPrice(p.min_price),
        artSeries: isArtSeriesSet(p.property_set),
        fromPrice: true, // min_price across the product's offers/conditions
        language: languageCode(p.language),
        // property_set says which finishes the printing exists in, not which copy is listed — only certain when foil-only
        foil:
            p.property_set?.foil === 'true' &&
            p.property_set?.nonfoil === 'false'
                ? true
                : undefined
    }));
}

// The search shows 24 products a page, newest first, and its props name the next page while there is one:
//   {"products":[…],"productsCount":30,"nextPage":2}
export function parseCartonNextPage(html: string): number | null {
    const next = Number(pageProps(html)?.nextPage);
    return Number.isInteger(next) && next > 1 ? next : null;
}

// The badges for CartOn's conditions ("heavaly" is the site's own spelling).
const CONDITIONS: Record<string, string> = {
    mint: 'M',
    'near-mint': 'NM',
    excellent: 'EX',
    good: 'GD',
    'lightly-played': 'LP',
    played: 'PL',
    'heavaly-played': 'HP',
    'heavily-played': 'HP'
};

// A product page (one printing), at the search product's url_path. `offers` holds each seller's offer:
//   {"product":{"name":"Counterspell (FDC-61)","image":"…","property_set":{…}},
//    "offers":[{"id":24560,"amount":1,"price":146,"status":"active",
//      "property_set":{"version":"non_foil","language":"en","condition":"mint"}, …seller details}]}
// Offers alike in finish, language, condition and price become one result with their stock added up, so no
// two results share both the page's URL and a price for the same kind of copy. `url` is the page's own URL.
export function parseCartonProduct(html: string, url: string): CardResult[] {
    const props = pageProps(html);
    const product = props?.product;
    if (!product?.name) return [];
    const offers: any[] = props.offers ?? [];

    const merged = new Map<string, CardResult>();
    for (const o of offers) {
        const amount = Number(o?.amount);
        if (o?.status !== 'active' || !(amount > 0)) continue;
        const { version, language, condition } = o.property_set ?? {};
        const result: CardResult = {
            shop: 'carton',
            name: product.name,
            url,
            image: abs(url, product.image ?? undefined),
            price: toPrice(o.price),
            artSeries: isArtSeriesSet(product.property_set),
            stock: amount,
            foil:
                version === 'foil'
                    ? true
                    : version === 'non_foil'
                      ? false
                      : undefined,
            language: languageCode(language),
            condition: CONDITIONS[condition as string]
        };
        const key = [
            result.foil,
            result.language,
            result.condition,
            result.price
        ].join('|');
        const same = merged.get(key);
        if (same) same.stock! += amount;
        else merged.set(key, result);
    }
    return [...merged.values()];
}
