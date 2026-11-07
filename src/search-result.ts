// What /api/search returns: types only. Shared between server and frontend — keep free of server-only imports.
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
    printings?: number; // >1 when the tile stands for several printings and links to an all-versions page (MTGin)
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
    card: string;
    links: CardResult[];
    errors: SearchError[];
};
