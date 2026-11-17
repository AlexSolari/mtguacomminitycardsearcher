import { toPrice } from '../../parsers/helpers';
import {
    mergeRows,
    type Finish,
    type ListCard,
    type ParsedList
} from '../list-card';

// api2.moxfield.com/v3/decks/all/<publicId>: a deck as JSON, the API behind moxfield.com/decks/<publicId>.
// Each board (mainboard, sideboard, commanders, companions…) lists its entries by id, one per card. A card the owner
// has in several printings or finishes is still one entry (its first printing, all the copies added up), with the
// real breakdown in `printingData`: rows of the same shape, which are read instead.
//
//   {"name":"Sell list","lastUpdatedAtUtc":"2026-09-14T22:39:01.717Z",
//    "boards":{
//      "mainboard":{"count":250,"cards":{
//        "EgDRZ":{"quantity":1,"finish":"foil",
//          "card":{"name":"Kroxa, Titan of Death's Hunger","scryfall_id":"cee0459b-9aac-4d2f-abe4-4d5fedde7eb8",
//            "set":"thb","cn":"221","prices":{"usd":2.5,"usd_foil":3.25}}},
//        "YnDy3":{"quantity":3,"finish":"foil","card":{…vow 44…},
//          "printingData":[{"quantity":1,"finish":"foil","card":{…vow 44…}},
//                          {"quantity":1,"finish":"nonFoil","card":{…vow 354…}},
//                          {"quantity":1,"finish":"foil","card":{…vow 354…}}]}, …}},
//      "sideboard":{"count":0,"cards":{}}, "maybeboard":{…}, "tokens":{…}, …}}
//
// `finish` is "nonFoil" or "foil" ("etched" is a guess at the third), and `prices` are Scryfall's, per finish.
// The maybeboard holds cards the owner is only considering, and tokens aren't cards anyone sells, so both are
// left out. A body that isn't a deck (a redesign, or not JSON at all) is null.
const SKIPPED_BOARDS = new Set(['maybeboard', 'tokens']);

const FINISHES: Record<string, Finish> = {
    nonfoil: 'nonfoil',
    foil: 'foil',
    etched: 'etched'
};
const PRICE_KEYS: Record<Finish, string> = {
    nonfoil: 'usd',
    foil: 'usd_foil',
    etched: 'usd_etched'
};
const SCRYFALL_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// to the cent, as the other sources' prices
const usd = (value: unknown) => {
    const price = toPrice(value);
    return price === null
        ? undefined
        : Math.round(price * 100) / 100 || undefined;
};

const isObject = (v: unknown): v is Record<string, any> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

function toCard(row: any): ListCard | null {
    const card = row?.card;
    const name = typeof card?.name === 'string' ? card.name.trim() : '';
    const quantity = row?.quantity;
    if (!name || !Number.isInteger(quantity) || quantity < 1) return null;
    const finish =
        FINISHES[String(row.finish).toLowerCase()] ??
        (row.isFoil === true ? 'foil' : 'nonfoil');
    const id: unknown = card.scryfall_id;
    const scryfallId =
        typeof id === 'string' && SCRYFALL_ID.test(id) ? id : undefined;
    const price = usd(card.prices?.[PRICE_KEYS[finish]]);
    return {
        name,
        quantity,
        finish,
        ...(typeof card.set === 'string' && { set: card.set.toLowerCase() }),
        ...(typeof card.cn === 'string' && { collectorNumber: card.cn }),
        // Scryfall's image path is the id's first two characters, then the id
        ...(scryfallId && {
            scryfallId,
            image: `https://cards.scryfall.io/normal/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`
        }),
        ...(price !== undefined && { usd: price })
    };
}

export function parseMoxfield(text: string): ParsedList | null {
    let deck: unknown;
    try {
        deck = JSON.parse(text);
    } catch {
        return null;
    }
    const boards = isObject(deck) ? deck.boards : undefined;
    if (!isObject(boards) || !isObject(boards.mainboard?.cards)) return null;
    const cards = Object.entries(boards)
        .filter(
            ([key, board]) => !SKIPPED_BOARDS.has(key) && isObject(board?.cards)
        )
        .flatMap(([, board]) => Object.values(board.cards))
        .flatMap((entry: any) =>
            Array.isArray(entry?.printingData) && entry.printingData.length
                ? entry.printingData
                : [entry]
        )
        // a malformed row is skipped, not the whole list
        .flatMap((row) => toCard(row) ?? []);
    const { name, lastUpdatedAtUtc } = deck as Record<string, unknown>;
    const editedAt = Date.parse(String(lastUpdatedAtUtc));
    return {
        ...(typeof name === 'string' && name.trim() && { title: name.trim() }),
        ...(Number.isFinite(editedAt) && { editedAt }),
        cards: mergeRows(cards)
    };
}
