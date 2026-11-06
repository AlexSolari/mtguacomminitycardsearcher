import { abs, decodeEntities } from './helpers';
import { languageCode, type CardResult } from '../../shops';

// carton.cards — Inertia.js app, results are JSON in <div id="app" data-page="...">.
export function parseCarton(html: string): CardResult[] {
    const base = 'https://carton.cards';
    const raw = html.match(/data-page="([^"]*)"/)?.[1];
    if (!raw) return [];
    const page = JSON.parse(decodeEntities(raw));
    const products: any[] = page?.props?.products ?? [];
    return products.map((p) => ({
        shop: 'carton' as const,
        name: p.name,
        url: abs(base, p.url_path)!,
        image: p.image ?? null,
        price: typeof p.min_price === 'number' ? p.min_price : null,
        artSeries:
            p.property_set?.layout === 'art_series' ||
            /art_series/.test(p.property_set?.set_name ?? ''),
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
