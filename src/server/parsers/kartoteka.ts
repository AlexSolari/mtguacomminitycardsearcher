import { abs, decodeEntities } from './helpers';
import type { CardResult } from '../../shops';

// kartoteka.in.ua — mostly a board-game shop (same Horoshop platform as Nerdik). The search page declares
//   var products = [{ article: "TDM-128f", brand_title: "Wizards of the Coast", title: "Twin Bolt", price: 13, url, in_stock }]
// and renders a catalogCard per product, whose image alt carries the treatment/finish ("Twin Bolt, Normal, Regular Foil").
// MTG singles are WotC products with a SET-NUMBER article ("f" suffix = foil); sealed MTG and board games are skipped.
// Product pages sit behind a bot challenge, so everything comes from the search page.
export function parseKartoteka(html: string, base: string): CardResult[] {
    // `var products = [...],` — one line, part of a multi-variable declaration
    const raw = html.match(/var products = (\[.*\])[,;]?\s*$/m)?.[1];
    if (!raw) return [];
    let products: any[];
    try {
        products = JSON.parse(raw);
    } catch {
        return [];
    }

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

    return products.flatMap((p) => {
        const article = String(p.article ?? '');
        const code = article.match(/^([A-Z0-9]{2,6})-(\d+[a-z]?)$/i);
        if (!p.in_stock || p.brand_title !== 'Wizards of the Coast' || !code)
            return [];

        const url = abs(base, String(p.url).replace(/\\\//g, '/'))!;
        const card = cards.get(new URL(url).pathname) ?? {};
        const title = String(p.title ?? '').trim();
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
        const edition = [
            `${code[1]!.toUpperCase()} #${number}`,
            ...treatments
        ].join(', ');

        return [
            {
                shop: 'kartoteka' as const,
                name: `${title} — ${edition}`,
                url,
                image: abs(base, card.image),
                price: typeof p.price === 'number' ? p.price : null,
                foil: foil || undefined
            }
        ];
    });
}
