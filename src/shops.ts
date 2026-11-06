// Shared between server and frontend — keep free of server-only imports.

export type ShopId = "gin" | "carton" | "manavault" | "nerdik" | "paytowin";

export const SHOP_INFO: Record<ShopId, { label: string; homepage: string; icon: string }> = {
  gin: { label: "MTGin", homepage: "https://mtgin.kyiv.ua", icon: "https://mtgin.kyiv.ua/favicon.png" },
  carton: { label: "CartOn", homepage: "https://carton.cards", icon: "https://carton.cards/icon.png" },
  manavault: { label: "Mana Vault", homepage: "https://manavaultstore.com", icon: "https://manavaultstore.com/favicon.ico" },
  nerdik: { label: "Nerdik", homepage: "https://nerdik.club", icon: "https://nerdik.club/assets/favicon.ico" },
  paytowin: { label: "PayToWin", homepage: "https://paytowin.club", icon: "https://paytowin.club/favicon-96x96.png" },
};

// "Jace, the Mind-Sculptor" → "jace the mind sculptor"
export const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Is `listing` exactly the searched card, ignoring shop decorations? Handles:
//   "Daze (PLST-DD2-23)"                         (CartOn set suffix)
//   "Daze — Nemesis #29, Foil, English"          (Nerdik edition suffix)
//   "Emeritus of Woe // Demonic Tutor"           (either face of a split / MDFC card, or the full name)
export function isExactMatch(listing: string, query: string) {
  const q = normalize(query);
  const name = listing.split(" — ")[0]!.replace(/\s+\([A-Z0-9]+-[^)]*\)$/i, "");
  return [name, ...name.split(" // ")].some(n => normalize(n) === q);
}

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
  oldPrice?: number; // pre-discount price (Nerdik)
  stock?: number; // copies for sale
  printings?: number; // >1 when the tile stands for several printings and links to an all-versions page (MTGin)
  foil?: boolean;
  language?: string; // upper-case code: EN, RU, JA…
  condition?: string; // short grade: NM, M, LP…
};

// Nerdik and others spell languages out; normalise to codes for the badge.
const LANGUAGE_CODES: Record<string, string> = {
  english: "EN", russian: "RU", japanese: "JA", german: "DE", french: "FR", italian: "IT", spanish: "ES",
  portuguese: "PT", korean: "KO", chinese: "ZH", "simplified chinese": "ZHS", "traditional chinese": "ZHT", ukrainian: "UK",
};
export const languageCode = (s: string | null | undefined) => {
  if (!s) return undefined;
  const t = s.trim();
  return LANGUAGE_CODES[t.toLowerCase()] ?? (t.length <= 3 ? t.toUpperCase() : undefined);
};

export type AuctionInfo = {
  currentBid: number | null; // null until someone bids
  startingPrice: number;
  buyNow: number | null;
  endsAt: string; // ISO timestamp
  bids: number;
};

// Art Series cards are collectible art cards, not playable copies — grouped separately and kept out of pricing.
export const isArtSeries = (l: CardResult) => l.artSeries === true || /\bart series\b/i.test(l.name);

export type SearchResult = {
  card: string;
  links: CardResult[];
  errors: string[];
};
