// Re-downloads the shop pages the parser tests run against (tests/fixtures/).
// Run it when a shop changes its markup: `bun scripts/update-fixtures.ts`, then `bun test` shows what broke,
// and `bun test --update-snapshots` accepts the new output once the parsers are fixed.
// About 8 requests, through ShopClient so they're spaced like the app's. Nerdik and MTGin need their API keys
// (NERDIK_API_KEY, MTGIN_API_KEY in .env); without one, that shop's fixture is left as it is.
import { mkdir } from 'node:fs/promises';
import { decodeEntities } from '../src/server/parsers/helpers';
import { jsonEnd } from '../src/server/parsers/scrapers/citadel';
import { manavaultSource } from '../src/server/searchers/manavault-card-searcher';
import { ShopClient } from '../src/server/shop-client';

const dir = new URL('../tests/fixtures/', import.meta.url);
await mkdir(dir, { recursive: true });

async function save(name: string, body: string) {
    await Bun.write(new URL(name, dir), body);
    console.log(`${name}  ${(body.length / 1024).toFixed(0)} KB`);
}
const json = (data: unknown) => JSON.stringify(data, null, 2) + '\n';
// keeps only `keys` of an object, so fixtures hold no fields (or personal data) the parsers don't read
const pick = (o: any, keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, o[k]]));

// Counterspell has many printings in most shops, so it exercises the multi-printing paths.
const CARD = 'Counterspell';

const carton = new ShopClient('https://carton.cards');
const cartonSearch = await carton.fetchHtml(carton.url('/search', { q: CARD }));
await save('carton-search.html', cartonSearch);

// CartOn's product pages name the sellers (also outside the page's JSON), so the fixture is rebuilt from the
// fields parseCartonProduct reads: the product, and each offer without seller details.
const cartonProps = (html: string) =>
    JSON.parse(decodeEntities(html.match(/data-page="([^"]*)"/)?.[1] ?? 'null'))
        ?.props;
const cartonProduct = cartonProps(cartonSearch)?.products?.[0];
if (!cartonProduct) throw new Error('CartOn: no products in the search page');
const productProps = cartonProps(
    await carton.fetchHtml(carton.url(cartonProduct.url_path))
);
const productJson = JSON.stringify({
    component: 'Products/Show',
    props: {
        product: pick(productProps.product, ['name', 'image', 'property_set']),
        offers: (productProps.offers ?? []).map((o: any) =>
            pick(o, ['id', 'amount', 'price', 'status', 'property_set'])
        )
    }
});
await save(
    'carton-product.html',
    `<div id="app" data-page="${productJson
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}"></div>\n`
);

// MTGin's API lists other sellers' offers too, so keep only the fields parseGin reads (no seller names).
const GIN_OFFER_FIELDS = [
    'name',
    'setName',
    'collectorNumber',
    'language',
    'finish',
    'condition',
    'signed',
    'quantity',
    'priceUah',
    'url',
    'imageUrl'
];
const ginKey = process.env.MTGIN_API_KEY;
if (ginKey) {
    const gin = new ShopClient('https://mtgin.kyiv.ua');
    const answer = await gin.fetchJson<{ results?: { offers?: any[] }[] }>(
        gin.url('/api/public/v1/search'),
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ginKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cards: [{ name: CARD }] })
        }
    );
    await save(
        'gin-search.json',
        json({
            results: (answer.results ?? []).map((r) => ({
                offers: (r.offers ?? []).map((o) =>
                    Object.fromEntries(GIN_OFFER_FIELDS.map((k) => [k, o[k]]))
                )
            }))
        })
    );
} else console.warn('MTGIN_API_KEY is not set, gin-search.json not updated');

// Mana Vault's price API. Its rows hold no seller data, but keep only what parseManavault reads anyway.
const MV_FIELDS = [
    'name',
    'setName',
    'number',
    'url',
    'image',
    'price',
    'fromPrice',
    'stock',
    'foil',
    'language',
    'condition',
    'artSeries',
    'etched',
    'altered',
    'signed'
];
const manavault = new ShopClient('https://manavaultstore.com');
const mv = await manavault.fetchJson<any>(
    manavault.url('/api/v1/prices', { q: CARD, source: manavaultSource() })
);
await save(
    'manavault-search.json',
    json({
        match: mv.match,
        results: mv.results.map((r: any) => pick(r, MV_FIELDS))
    })
);

const apiKey = process.env.NERDIK_API_KEY;
if (apiKey) {
    const nerdik = new ShopClient('https://hub.nerdik.club');
    await save(
        'nerdik-batch.json',
        json(
            await nerdik.fetchJson(nerdik.url('/api/singles/search/batch'), {
                method: 'POST',
                headers: {
                    'X-API-Key': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    game: 'mtg',
                    limit: 60,
                    cards: [{ name: CARD, quantity: 1 }]
                })
            })
        )
    );
} else console.warn('NERDIK_API_KEY is not set, nerdik-batch.json not updated');

// Kartoteka has few singles; Sol Ring is one it usually stocks.
const kartoteka = new ShopClient('https://kartoteka.in.ua');
await save(
    'kartoteka-search.html',
    await kartoteka.fetchHtml(kartoteka.url('/ua/search/', { q: 'Sol Ring' }))
);

// PayToWin has only a handful of live auctions; an empty query lists them all.
// Lots are posted by private people, so keep only the fields parsePaytowin reads: no seller or bidder names,
// cities or free-text descriptions in the repo.
const PAYTOWIN_FIELDS = [
    'id',
    'title',
    'status',
    'condition',
    'foil',
    'language',
    'starting_price_uah',
    'buy_now_uah',
    'current_high_uah',
    'bid_count',
    'end_time'
];
const paytowin = new ShopClient('https://api.paytowin.club');
const auctions = await paytowin.fetchJson<{ items?: any[] }>(
    paytowin.url('/auctions', { q: '', game: 'magic', limit: '50' })
);
await save(
    'paytowin-auctions.json',
    json({
        items: (auctions.items ?? []).map((a) => ({
            ...Object.fromEntries(PAYTOWIN_FIELDS.map((k) => [k, a[k]])),
            photos: (a.photos ?? []).slice(0, 1).map((p: any) => ({
                urls: { medium: p.urls?.medium, thumb: p.urls?.thumb }
            }))
        }))
    })
);

// Magic Swamp is a marketplace of private sellers with a small stock, so an empty search lists a page of
// everything. Keep only the fields parseMagicswamp reads: no seller names, ids, ratings, photos or descriptions.
const MAGICSWAMP_CARD_FIELDS = [
    'card_name',
    'set_name',
    'card_image_url',
    'game'
];
const MAGICSWAMP_OFFER_FIELDS = [
    'listing_id',
    'price',
    'currency',
    'condition',
    'is_foil',
    'foil_type',
    'quantity',
    'language'
];
const magicswamp = new ShopClient('https://magicswamp.com.ua');
const swamp = await magicswamp.fetchJson<{ data?: any[] }>(
    magicswamp.url('/api/listings/grouped/cards', {
        game: 'mtg',
        search: '',
        limit: '50'
    })
);
await save(
    'magicswamp-search.json',
    json({
        data: (swamp.data ?? []).map((c) => ({
            ...pick(c, MAGICSWAMP_CARD_FIELDS),
            sellers: (c.sellers ?? []).map((o: any) =>
                pick(o, MAGICSWAMP_OFFER_FIELDS)
            )
        }))
    })
);

// Citadel stocks few singles, so an empty search lists a page of everything. Its data sits in the page's
// Server Components payload (see parsers/scrapers/citadel.ts); the items there also carry cart reservations, so the
// payload's `items` is cut down to the fields parseCitadel reads. The rendered markup holds no personal data.
const CITADEL_ITEM_FIELDS = [
    'scryfall_id',
    'name',
    'set_name',
    'variant',
    'foilType',
    'isFoil',
    'promo',
    'faces',
    'prices',
    'quantity',
    'availableQty',
    'lang',
    'condition'
];
const citadel = new ShopClient('https://citadel.kyiv.ua');
let citadelItems = 0;
const citadelPage = (
    await citadel.fetchHtml(citadel.url('/singles', { q: '' }))
).replace(
    /(self\.__next_f\.push\(\[1,)("(?:[^"\\]|\\.)*")(\]\))/g,
    (script, open: string, literal: string, close: string) => {
        const data: string = JSON.parse(literal);
        const at = data.indexOf('"items":[');
        if (at < 0) return script;
        const start = at + '"items":'.length;
        const end = jsonEnd(data, start);
        if (end < 0) throw new Error('Citadel: `items` spans several scripts');
        const items = JSON.parse(data.slice(start, end)).map((it: any) =>
            pick(it, CITADEL_ITEM_FIELDS)
        );
        citadelItems += items.length;
        const payload =
            data.slice(0, start) + JSON.stringify(items) + data.slice(end);
        // as Next.js writes it: no "<" that could close the script early
        return open + JSON.stringify(payload).replace(/</g, '\\u003c') + close;
    }
);
if (!citadelItems) throw new Error('Citadel: no items in the search page');
await save('citadel-search.html', citadelPage);
