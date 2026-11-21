import type { CardResult } from '../../../search-result';
import { languageCode, toPrice, withEdition } from '../helpers';

// hub.nerdik.club/api/singles/search/batch — JSON, one result per looked-up name, in request order; each lists
// that card's printings, each with its in-stock offers:
//   {"results":[{"index":0,"name":"Sol Ring","quantity":1,
//     "cards":[{"name":"Sol Ring","game":"mtg","set_name":"Fallout","number":"359","language":"en",
//       "treatment":"regular","image_url":"https://cards.scryfall.io/…","nerdik_url":"https://nerdik.club/mtg/singles/pip/359/en/",
//       "offers":[{"price_uah":"183.00","available_quantity":1,"nerdik_url":"…"}, …]}, …],
//     "next_cursor":null}, …], "currency":"UAH", …}
// parseNerdik reads one of those results.
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

// `name` echoes the name as sent (the searcher pairs results with names by it, see pairAnswers)
export type NerdikResult = { name?: string; cards?: NerdikCard[] };
export type NerdikBatchResponse = { results?: NerdikResult[] };

// A malformed printing or offer (null, no name or link, no offers) is skipped, not thrown on: it would take the
// card's other offers with it.
export function parseNerdik(json: NerdikResult | undefined): CardResult[] {
    return (json?.cards ?? []).flatMap((card) => {
        // the shop also sells other TCGs (e.g. Sorcery: Contested Realms)
        if (card?.game !== 'mtg' || !card.name) return [];
        // "Sol Ring — Fallout #359"
        const name = withEdition(card.name, card.set_name, card.number);
        const foil =
            card.treatment === 'regular'
                ? false
                : /foil|etched/i.test(card.treatment ?? '')
                  ? true
                  : undefined;
        return (card.offers ?? [])
            .filter(
                (o) =>
                    o?.available_quantity > 0 &&
                    (o.nerdik_url ?? card.nerdik_url)
            )
            .map((offer) => ({
                shop: 'nerdik' as const,
                name,
                url: offer.nerdik_url ?? card.nerdik_url,
                image: card.image_url,
                price: toPrice(offer.price_uah), // a decimal string, "183.00"
                stock: offer.available_quantity,
                foil,
                language: languageCode(card.language)
            }));
    });
}
