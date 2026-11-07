import {
    abs,
    decodeEntities,
    extractJsonArray,
    parsePrice,
    readNextFlight
} from './helpers';
import { languageCode, type CardResult } from '../../shops';

// mtgin.kyiv.ua — Next.js; the result grid's props carry structured items:
//   { href, name, image, printings, copies, price, language: "en", finish: "nonfoil"|"foil"|…, set_name, collector_number }
// A tile with printings > 1 is a summary linking to the card's all-versions page, priced "from".
// Falls back to scraping the rendered HTML if the payload shape changes.
export function parseGin(html: string, base: string): CardResult[] {
    let items: any[] | null = null;
    try {
        items = extractJsonArray(readNextFlight(html), 'items');
    } catch {}
    if (!items) return parseGinHtml(html, base);

    return items
        .filter((i) => i?.href && i?.name)
        .map((i) => {
            const many = (i.printings ?? 1) > 1;
            const edition =
                !many && i.set_name
                    ? ` — ${i.set_name}${i.collector_number ? ` #${i.collector_number}` : ''}`
                    : '';
            return {
                shop: 'gin' as const,
                name: `${i.name}${edition}`,
                url: abs(base, i.href)!,
                image: abs(base, i.image),
                price: typeof i.price === 'number' ? i.price : null,
                artSeries: !many && /art series/i.test(i.set_name ?? ''),
                fromPrice: many || undefined,
                printings: many ? i.printings : undefined,
                stock: typeof i.copies === 'number' ? i.copies : undefined,
                // per-printing details only make sense when the tile is one printing
                foil: !many && i.finish ? i.finish !== 'nonfoil' : undefined,
                language: many ? undefined : languageCode(i.language)
            };
        });
}

// mtgin.kyiv.ua/cards/oracle/<id>-<slug> — all printings of one card, one <article class="marketplacePrinting"> each:
//   <h2>Fifth Edition</h2> <p>#77 · EN · Звичайна|Foil</p> <img alt="Counterspell" src="/api/card-images/…">
//   then one offer per seller: <a href="/shops/mtgin/cards/1235-counterspell">MTGin</a> <small>В наявності: 3</small> <strong>124 ₴</strong>
export function parseGinPrintings(html: string, base: string): CardResult[] {
    return html
        .replace(/<!-- -->/g, '')
        .split('<article class="marketplacePrinting"')
        .slice(1)
        .flatMap((chunk) => {
            const block = chunk.slice(0, chunk.indexOf('</article>'));
            const set = decodeEntities(
                block.match(/<h2[^>]*>([^<]+)<\/h2>/)?.[1] ?? ''
            ).trim();
            const [number, lang, finish] = (
                block.match(/<p[^>]*>#([^<]+)<\/p>/)?.[1] ?? ''
            )
                .split('·')
                .map((s) => s.trim());
            const card = decodeEntities(
                block.match(/<img alt="([^"]+)"/)?.[1] ?? ''
            );
            const image = abs(base, block.match(/<img[^>]*src="([^"]+)"/)?.[1]);
            const foil = finish
                ? /foil|фольг|фойл|etched/i.test(finish)
                : undefined;
            const edition = [
                set && number ? `${set} #${number}` : set,
                foil || !finish || /звичайн/i.test(finish) ? null : finish
            ]
                .filter(Boolean)
                .join(', ');

            // one result per seller offer for this printing
            return block
                .split(/(?=<a[^>]*href="\/shops\/)/)
                .slice(1)
                .flatMap((offer) => {
                    const href = offer.match(/href="(\/shops\/[^"]+)"/)?.[1];
                    if (!href || !card) return [];
                    return [
                        {
                            shop: 'gin' as const,
                            name: edition ? `${card} — ${edition}` : card,
                            url: abs(base, href)!,
                            image,
                            price: parsePrice(
                                offer.match(
                                    /<strong[^>]*>([^<]+)<\/strong>/
                                )?.[1]
                            ),
                            stock:
                                Number(
                                    offer.match(/В наявності:\s*(\d+)/)?.[1]
                                ) || undefined,
                            foil,
                            language: languageCode(lang),
                            artSeries: /art series/i.test(set)
                        }
                    ];
                });
        });
}

function parseGinHtml(html: string, base: string): CardResult[] {
    return html
        .split('<article class="card marketplaceCard"')
        .slice(1)
        .flatMap((block) => {
            const href = block.match(
                /data-catalog-card-link="true" href="([^"]+)"/
            )?.[1];
            if (!href) return [];
            return [
                {
                    shop: 'gin' as const,
                    name: decodeEntities(
                        block.match(/<h2><a[^>]*>([^<]+)<\/a>/)?.[1] ?? ''
                    ),
                    url: abs(base, href)!,
                    image: abs(
                        base,
                        block.match(/<img[^>]*src="([^"]+)"/)?.[1]
                    ),
                    // single printing: <div class="buy"><strong>; multiple printings: <div class="marketplacePrice"><small>…</small><strong> ("from" price)
                    price: parsePrice(
                        block.match(
                            /<div class="(?:buy|marketplacePrice)">(?:<small>[^<]*<\/small>)?<strong>([^<]+)<\/strong>/
                        )?.[1]
                    ),
                    // single-printing tiles name their set: <a class="catalogSetLink" href="/sets/ddc">Duel Decks: …</a>
                    artSeries:
                        /class="catalogSetLink"[^>]*>[^<]*Art Series/i.test(
                            block
                        )
                }
            ];
        });
}
