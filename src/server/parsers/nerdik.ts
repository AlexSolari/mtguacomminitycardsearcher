import { abs, decodeEntities, parsePrice } from "./helpers";
import { languageCode, type CardResult } from "../../shops";

// nerdik.club — server-rendered catalog, one <div class="catalogCard j-catalog-card"> per product, 20 per page.
// The page mixes in out-of-stock items; we drop them. (The site's own "in stock" filter URL sits behind a
// bot challenge, so we filter here instead.)
export function parseNerdik(html: string): CardResult[] {
  const base = "https://nerdik.club";
  return html
    .split('<div class="catalogCard j-catalog-card">')
    .slice(1)
    .flatMap((block) => {
      if (block.includes("__out-of-stock")) return [];
      const title = block.match(/<div class="catalogCard-title">\s*<a href='([^']+)'\s+title="([^"]+)"/);
      // the shop also sells other TCGs (e.g. Sorcery: Contested Realms) — MTG lives under /mtg/
      if (!title || !title[1]!.startsWith("/mtg/")) return [];
      // "Sol Ring — Magic: The Gathering, Fallout #359, Non-foil, English"
      //   → name "Sol Ring — Fallout #359", foil false, language EN (finish and language become badges)
      const [card, details = ""] = decodeEntities(title[2]!).split(" — Magic: The Gathering, ");
      const parts = details.split(", ");
      const language = parts.length > 1 ? languageCode(parts.at(-1)) : undefined;
      if (language) parts.pop();
      const finish = parts.at(-1);
      const foil = finish && /^(non-?foil|foil|etched.*)$/i.test(finish) ? !/^non/i.test(finish) : undefined;
      if (foil !== undefined) parts.pop();
      const edition = parts.join(", ");

      const price = parsePrice(block.match(/<div class="catalogCard-price(?: __light)?">([^<]+)</)?.[1]);
      const oldPrice = parsePrice(block.match(/<div class="catalogCard-oldPrice">([^<]+)</)?.[1]);
      return [
        {
          shop: "nerdik" as const,
          name: edition ? `${card} — ${edition}` : card!,
          url: abs(base, title[1]!)!,
          image: abs(base, block.match(/<img[^>]*class='catalogCard-img'[^>]*src='([^']+)'/)?.[1]),
          // exact class match so the struck-through catalogCard-oldPrice is skipped
          price,
          oldPrice: oldPrice !== null && price !== null && oldPrice > price ? oldPrice : undefined,
          foil,
          language,
        },
      ];
    });
}
