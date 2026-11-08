import type { CardResult } from '../../../search-result';
import { languageCode } from '../helpers';

// hub.nerdik.club/api/singles/search — JSON, one entry per printing, each with its in-stock offers:
//   {"cards":[{"name":"Sol Ring","game":"mtg","set_name":"Fallout","number":"359","language":"en",
//     "treatment":"regular","image_url":"https://cards.scryfall.io/…","nerdik_url":"https://nerdik.club/mtg/singles/pip/359/en/",
//     "offers":[{"price_uah":"183.00","available_quantity":1,"nerdik_url":"…"}, …]}, …],
//    "next_cursor":null, …}
// A printing can have several offers at different prices; each becomes its own result so the total uses each
// price for its own stock.
type NerdikCard = {
    name: string;
    game: string;
    set_name: string | null;
    number: string | null;
    language: string | null;
    treatment: string | null; // "regular", "foil"; other games use their own ("standard")
    image_url: string | null;
    nerdik_url: string;
    offers: {
        price_uah: string;
        available_quantity: number;
        nerdik_url: string | null;
    }[];
};

export type NerdikResponse = { cards?: NerdikCard[] };

export function parseNerdik(json: NerdikResponse): CardResult[] {
    return (json.cards ?? []).flatMap((card) => {
        // the shop also sells other TCGs (e.g. Sorcery: Contested Realms)
        if (card.game !== 'mtg') return [];
        // "Sol Ring — Fallout #359", the same shape the old HTML parser built (isExactMatch splits on " — ")
        const edition = [card.set_name, card.number && `#${card.number}`]
            .filter(Boolean)
            .join(' ');
        const foil =
            card.treatment === 'regular'
                ? false
                : /foil|etched/i.test(card.treatment ?? '')
                  ? true
                  : undefined;
        return card.offers
            .filter((o) => o.available_quantity > 0)
            .map((offer) => ({
                shop: 'nerdik' as const,
                name: edition ? `${card.name} — ${edition}` : card.name,
                url: offer.nerdik_url ?? card.nerdik_url,
                image: card.image_url,
                // "183.00" — a decimal string, so not parsePrice (which would read it as 18300)
                price: parseUah(offer.price_uah),
                stock: offer.available_quantity,
                foil,
                language: languageCode(card.language)
            }));
    });
}

const parseUah = (s: string | null | undefined) => {
    const n = s ? Number(s) : NaN;
    return Number.isFinite(n) ? n : null;
};
