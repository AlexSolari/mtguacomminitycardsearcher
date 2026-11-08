// Re-downloads the shop pages the parser tests run against (tests/fixtures/).
// Run it when a shop changes its markup: `bun scripts/update-fixtures.ts`, then `bun test` shows what broke,
// and `bun test --update-snapshots` accepts the new output once the parsers are fixed.
// About 7 requests, through ShopClient so they're spaced like the app's. Nerdik and MTGin need their API keys
// (NERDIK_API_KEY, MTGIN_API_KEY in .env); without one, that shop's fixture is left as it is.
import { mkdir } from 'node:fs/promises';
import { ShopClient } from '../src/server/shop-client';

const dir = new URL('../tests/fixtures/', import.meta.url);
await mkdir(dir, { recursive: true });

async function save(name: string, body: string) {
    await Bun.write(new URL(name, dir), body);
    console.log(`${name}  ${(body.length / 1024).toFixed(0)} KB`);
}
const json = (data: unknown) => JSON.stringify(data, null, 2) + '\n';

// Counterspell has many printings in most shops, so it exercises the multi-printing paths.
const CARD = 'Counterspell';

const carton = new ShopClient('https://carton.cards');
await save(
    'carton-search.html',
    await carton.fetchHtml(carton.url('/search', { q: CARD }))
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

const manavault = new ShopClient('https://manavaultstore.com');
await save(
    'manavault-search.html',
    await manavault.fetchHtml(manavault.url('/cards', { q: CARD }))
);
await save(
    'manavault-versions.html',
    await manavault.fetchHtml(manavault.url('/cards/versions', { name: CARD }))
);

const apiKey = process.env.NERDIK_API_KEY;
if (apiKey) {
    const nerdik = new ShopClient('https://hub.nerdik.club');
    await save(
        'nerdik-search.json',
        json(
            await nerdik.fetchJson(
                nerdik.url('/api/singles/search', { q: CARD, limit: '60' }),
                { headers: { 'X-API-Key': apiKey } }
            )
        )
    );
} else
    console.warn('NERDIK_API_KEY is not set, nerdik-search.json not updated');

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
