// Shared between server and frontend — keep free of server-only imports.

export type ShopId = "gin" | "carton" | "manavault" | "nerdik";

export const SHOP_INFO: Record<ShopId, { label: string; homepage: string; icon: string }> = {
  gin: { label: "MTGin", homepage: "https://mtgin.kyiv.ua", icon: "https://mtgin.kyiv.ua/favicon.png" },
  carton: { label: "CartOn", homepage: "https://carton.cards", icon: "https://carton.cards/icon.png" },
  manavault: { label: "Mana Vault", homepage: "https://manavaultstore.com", icon: "https://manavaultstore.com/favicon.ico" },
  nerdik: { label: "Nerdik", homepage: "https://nerdik.club", icon: "https://nerdik.club/assets/favicon.ico" },
};

export type CardResult = {
  shop: ShopId;
  name: string;
  url: string;
  image: string | null;
  price: number | null; // UAH
};

export type SearchResult = {
  card: string;
  links: CardResult[];
  errors: string[];
};
