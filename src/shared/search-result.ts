// What /api/search streams: types only. Shared between server and frontend — keep free of server-only imports.
import type { ShopId } from '@/shared/shops';

export type CardResult = {
    shop: ShopId;
    name: string;
    url: string;
    image: string | null;
    price: number | null; // UAH; null for traders' offers, which are priced in USD (usdPrice)
    artSeries?: boolean; // set by parsers that know the set/layout (CartOn, MTGin); otherwise inferred from the name
    auction?: AuctionInfo; // auction lot rather than a fixed-price offer (PayToWin) — `price` is the current/starting bid

    // Optional details — each shop fills in what it exposes (see the parsers).
    fromPrice?: boolean; // `price` is the cheapest of several offers/conditions ("від …")
    oldPrice?: number; // pre-discount price
    stock?: number; // copies for sale
    foil?: boolean;
    language?: string; // upper-case code: EN, RU, JA…
    condition?: string; // short grade: NM, M, LP…

    // A trader's offer (shop 'traders'): a card in their list, with `url` their Telegram. Its price is Scryfall's in
    // USD, shown in UAH at the trader's own rate when they set one (sellerUah in results.ts). It's a guide, not
    // their asking price, so it stays out of best price and the totals either way.
    seller?: Seller;
    usdPrice?: number;
    approxPrice?: boolean; // the price is for the card or its set, not necessarily this printing
    usdRate?: number; // the trader's UAH per USD, for this list
};

export type Seller = {
    name: string; // as on Telegram
    username: string; // Telegram, without the @
    list: string; // the list on MTGGoldfish, ManaBox or Moxfield
    listTitle: string | null;
    updatedAt: number; // when the list was last read, ms since the epoch
    printing: string | null; // what the list says of the printing: "RVR · retro", "C21 · #263"
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

// Where an offer was shown: one of a card's result groups, or 'manual' for a blocked shop's manual-check tile.
export type OfferGroup =
    'exact' | 'auctions' | 'traders' | 'other' | 'art' | 'manual';

// POST /api/click's body: an offer the user opened, so the dashboard shows which shops and offers people go to.
export type OfferClick = {
    shop: ShopId;
    card: string; // the card searched (SearchResult.card), not the shop's title for the listing
    group: OfferGroup;
    view: 'grid' | 'table' | 'plan'; // 'plan': the order planner
    best: boolean; // had the best-price badge
    price: number | null; // UAH, as shown; null for a manual check or a trader's offer
};

// One line of /api/search's NDJSON response: the result so far for `cards[index]`. A card gets a line each time
// one of its shops finishes, each a full snapshot that replaces the previous; the last one has no `pending`.
export type SearchUpdate = {
    index: number;
    result: SearchResult;
};
