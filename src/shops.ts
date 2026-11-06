// Shared between server and frontend — keep free of server-only imports.

export type ShopId = "gin" | "carton" | "manavault" | "nerdik";

export const SHOP_INFO: Record<ShopId, { label: string; homepage: string; icon: string }> = {
  gin: { label: "MTGin", homepage: "https://mtgin.kyiv.ua", icon: "https://mtgin.kyiv.ua/favicon.png" },
  carton: { label: "CartOn", homepage: "https://carton.cards", icon: "https://carton.cards/icon.png" },
  manavault: { label: "Mana Vault", homepage: "https://manavaultstore.com", icon: "https://manavaultstore.com/favicon.ico" },
  nerdik: { label: "Nerdik", homepage: "https://nerdik.club", icon: "https://nerdik.club/assets/favicon.ico" },
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
};

// Art Series cards are collectible art cards, not playable copies — grouped separately and kept out of pricing.
export const isArtSeries = (l: CardResult) => l.artSeries === true || /\bart series\b/i.test(l.name);

export type SearchResult = {
  card: string;
  links: CardResult[];
  errors: string[];
};
