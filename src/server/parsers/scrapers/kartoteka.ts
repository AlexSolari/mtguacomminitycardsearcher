import {
    abs,
    asString,
    decodeEntities,
    toPrice,
    withEdition
} from '@/server/parsers/helpers';
import type { CardResult } from '@/shared/search-result';

// kartoteka.in.ua — mostly a board-game shop (same Horoshop platform as Nerdik). The search page declares
//   var products = [{ article: "TDM-128f", brand_title: "Wizards of the Coast", title: "Twin Bolt", price: 13, url, in_stock }]
// and renders a catalogCard per product, whose image alt carries the treatment/finish ("Twin Bolt, Normal, Regular Foil").
// MTG singles are WotC products with a SET-NUMBER article ("f" suffix = foil); sealed MTG and board games are skipped.
// Product pages sit behind a bot challenge, so everything comes from the search page.
// Every field is checked: a product that isn't what we expect (no title or link, a link that isn't one) is skipped,
// not allowed to fail the whole page.
type Product = Partial<
    Record<
        'article' | 'brand_title' | 'title' | 'price' | 'url' | 'in_stock',
        unknown
    >
>;

export function parseKartoteka(html: string, base: string): CardResult[] {
    // `var products = [...],` — one line, part of a multi-variable declaration
    const raw = html.match(/var products = (\[.*\])[,;]?\s*$/m)?.[1];
    if (!raw) return [];
    let products: unknown;
    try {
        products = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(products)) return [];

    // url path → { image, alt } from the rendered cards
    const cards = new Map<string, { image?: string; alt?: string }>();
    for (const block of html
        .split('<div class="catalogCard j-catalog-card">')
        .slice(1)) {
        const href = block.match(/<a href='([^']+)'/)?.[1];
        const img = block.match(
            /<img alt='([^']*)'\s+class='catalogCard-img'[^>]*src='([^']+)'/
        );
        if (href)
            cards.set(href, {
                alt: img?.[1] && decodeEntities(img[1]),
                image: img?.[2]
            });
    }

    return products.flatMap((item): CardResult[] => {
        const p = (item ?? {}) as Product;
        const code = (asString(p.article) ?? '').match(
            /^([A-Z0-9]{2,6})-(\d+[a-z]?)$/i
        );
        if (!p.in_stock || p.brand_title !== 'Wizards of the Coast' || !code)
            return [];
        const title = asString(p.title)?.trim();
        // JSON.parse has already turned the page's "https:\/\/…" into "https://…"
        const url = abs(base, asString(p.url));
        if (!title || !url) return [];

        const card = cards.get(new URL(url).pathname) ?? {};
        // alt = "<title>, Normal[, Regular Foil]" — keep treatments other than "Normal"/foil for the name
        const tags = card.alt?.startsWith(title)
            ? card.alt
                  .slice(title.length)
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
            : [];
        const foil = /f$/.test(code[2]!) || tags.some((t) => /foil/i.test(t));
        const treatments = tags.filter(
            (t) => t !== 'Normal' && !/foil/i.test(t)
        );
        const number = code[2]!.replace(/f$/, '');

        return [
            {
                shop: 'kartoteka',
                // "Sol Ring — CMM #410, Borderless"
                name: withEdition(
                    title,
                    code[1]!.toUpperCase(),
                    number,
                    ...treatments
                ),
                url,
                image: abs(base, card.image),
                price: toPrice(p.price),
                foil: foil || undefined
            }
        ];
    });
}
