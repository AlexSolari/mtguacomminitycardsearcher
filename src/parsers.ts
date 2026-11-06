import type { CardResult } from "./shops";

export type { CardResult };

const decodeEntities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const parsePrice = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && s.trim() ? n : null;
};

const abs = (base: string, path: string | undefined) => (path ? new URL(decodeEntities(path), base).href : null);

// mtgin.kyiv.ua — server-rendered Next.js, one <article class="card marketplaceCard"> per card.
export function parseGin(html: string): CardResult[] {
  const base = "https://mtgin.kyiv.ua";
  return html
    .split('<article class="card marketplaceCard"')
    .slice(1)
    .flatMap((block) => {
      const href = block.match(/data-catalog-card-link="true" href="([^"]+)"/)?.[1];
      if (!href) return [];
      return [
        {
          shop: "gin" as const,
          name: decodeEntities(block.match(/<h2><a[^>]*>([^<]+)<\/a>/)?.[1] ?? ""),
          url: abs(base, href)!,
          image: abs(base, block.match(/<img[^>]*src="([^"]+)"/)?.[1]),
          // single printing: <div class="buy"><strong>; multiple printings: <div class="marketplacePrice"><small>…</small><strong> ("from" price)
          price: parsePrice(block.match(/<div class="(?:buy|marketplacePrice)">(?:<small>[^<]*<\/small>)?<strong>([^<]+)<\/strong>/)?.[1]),
          // single-printing tiles name their set: <a class="catalogSetLink" href="/sets/ddc">Duel Decks: …</a>
          artSeries: /class="catalogSetLink"[^>]*>[^<]*Art Series/i.test(block),
        },
      ];
    });
}

// carton.cards — Inertia.js app, results are JSON in <div id="app" data-page="...">.
export function parseCarton(html: string): CardResult[] {
  const base = "https://carton.cards";
  const raw = html.match(/data-page="([^"]*)"/)?.[1];
  if (!raw) return [];
  const page = JSON.parse(decodeEntities(raw));
  const products: any[] = page?.props?.products ?? [];
  return products.map((p) => ({
    shop: "carton" as const,
    name: p.name,
    url: abs(base, p.url_path)!,
    image: p.image ?? null,
    price: typeof p.min_price === "number" ? p.min_price : null,
    artSeries: p.property_set?.layout === "art_series" || /art_series/.test(p.property_set?.set_name ?? ""),
  }));
}

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
      return [
        {
          shop: "nerdik" as const,
          // "Sol Ring — Magic: The Gathering, Set Name #140, Non-foil, English" → "Sol Ring — Set Name #140, Non-foil, English"
          name: decodeEntities(title[2]!).replace(" — Magic: The Gathering, ", " — "),
          url: abs(base, title[1]!)!,
          image: abs(base, block.match(/<img[^>]*class='catalogCard-img'[^>]*src='([^']+)'/)?.[1]),
          // exact class match so the struck-through catalogCard-oldPrice is skipped
          price: parsePrice(block.match(/<div class="catalogCard-price(?: __light)?">([^<]+)</)?.[1]),
        },
      ];
    });
}

// manavaultstore.com/cards/versions?name=<exact name> — every printing of one card, one tile each:
//   <a class="group flex flex-col rounded-xl border …" href="/cards/<scryfall id>">
//     <img alt="Sol Ring" src="/api/card-img/front/…webp">
//     <p><img set-icon/>Outlaws of Thunder Junction Commander</p> <p>OTC · №267</p> <p>Borderless?</p>
//     <p>у продажу 1 шт. · від 100 ₴</p>   — or "немає в продажу" (not for sale), which we drop
export function parseManavaultVersions(html: string): CardResult[] {
  const base = "https://manavaultstore.com";
  return html
    .split('<a class="group flex flex-col rounded-xl border')
    .slice(1)
    .flatMap((chunk) => {
      const block = chunk.slice(0, chunk.indexOf("</a>"));
      const href = block.match(/href="(\/cards\/[^"]+)"/)?.[1];
      if (!href || !block.includes("у продажу")) return [];

      const text = block
        .replace(/<!-- -->/g, "")
        .split(/<[^>]+>/)
        .map((s) => decodeEntities(s).trim())
        .filter(Boolean);
      const numIdx = text.findIndex((s) => s.includes("№"));
      const set = numIdx > 0 ? text[numIdx - 1] : undefined;
      const number = text[numIdx]?.match(/№\s*(\S+)/)?.[1];
      const finish = text[numIdx + 1] && !text[numIdx + 1]!.includes("продажу") ? text[numIdx + 1] : undefined;
      const card = decodeEntities(block.match(/<img alt="([^"]+)"/)?.[1] ?? "");

      // "Sol Ring — Outlaws of Thunder Junction Commander #267, Borderless" (same shape as Nerdik's names)
      const edition = [set && number ? `${set} #${number}` : set, finish].filter(Boolean).join(", ");
      return [
        {
          shop: "manavault" as const,
          name: edition ? `${card} — ${edition}` : card,
          url: abs(base, href)!,
          image: abs(base, block.match(/<img alt="[^"]*"[^>]*src="([^"]+)"/)?.[1]),
          price: parsePrice(text.join(" ").match(/від\s*([\d\s  ]+)\s*₴/)?.[1]),
        },
      ];
    });
}

// manavaultstore.com — server-rendered Next.js, one <a class="group flex flex-col" href="/cards/<scryfall id>"> per card.
export function parseManavault(html: string): CardResult[] {
  const base = "https://manavaultstore.com";
  return html
    .split('<a class="group flex flex-col" href="')
    .slice(1)
    .flatMap((block) => {
      const href = block.slice(0, block.indexOf('"'));
      if (!href.startsWith("/cards/")) return [];
      return [
        {
          shop: "manavault" as const,
          name: decodeEntities(block.match(/<h3[^>]*>([^<]+)<\/h3>/)?.[1] ?? ""),
          url: abs(base, href)!,
          image: abs(base, block.match(/<img[^>]*src="([^"]+)"/)?.[1]),
          price: parsePrice(block.match(/([\d\s]+)\s*₴/)?.[1]),
        },
      ];
    });
}
