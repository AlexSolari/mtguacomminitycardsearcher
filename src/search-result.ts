// What /api/search streams: types only. Shared between server and frontend — keep free of server-only imports.
import type { ShopId } from './shops';

export type CardResult = {
    shop: ShopId;
    name: string;
    url: string;
    image: string | null;
    price: number | null; // UAH
    artSeries?: boolean; // set by parsers that know the set/layout (CartOn, MTGin); otherwise inferred from the name
    auction?: AuctionInfo; // auction lot rather than a fixed-price offer (PayToWin) — `price` is the current/starting bid

    // Optional details — each shop fills in what it exposes (see the parsers).
    fromPrice?: boolean; // `price` is the cheapest of several offers/conditions ("від …")
    oldPrice?: number; // pre-discount price
    stock?: number; // copies for sale
    foil?: boolean;
    language?: string; // upper-case code: EN, RU, JA…
    condition?: string; // short grade: NM, M, LP…
};

export type AuctionInfo = {
    currentBid: number | null; // null until someone bids
    startingPrice: number;
    buyNow: number | null;
    endsAt: string; // ISO timestamp
    bids: number;
};

// A search that failed — on one shop (`shop` set), or the whole request for the card (no `shop`).
export type SearchError = {
    shop?: ShopId;
    message: string; // short technical reason, e.g. "HTTP 429"
    status?: number; // HTTP status, when the shop answered with an error
};

export type SearchResult = {
    card: string; // the name searched, corrected by Scryfall when the typed one wasn't a card's name
    typed?: string; // the name as typed, set only when it was corrected
    links: CardResult[];
    errors: SearchError[];
    pending?: ShopId[]; // shops still searching; set only on the snapshots streamed before the result is complete
};

// One line of /api/search's NDJSON response: the result so far for `cards[index]`. A card gets a line each time
// one of its shops finishes, each a full snapshot that replaces the previous; the last one has no `pending`.
export type SearchUpdate = {
    index: number;
    result: SearchResult;
};
