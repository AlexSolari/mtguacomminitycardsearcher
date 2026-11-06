import { languageCode, type CardResult } from "./shops";

export type { CardResult };

// Next.js App Router pages stream their data as `self.__next_f.push([1,"<chunk>"])` scripts. Concatenating the
// (JSON-string-encoded) chunks gives the "flight" payload, where component props appear as plain JSON.
function readNextFlight(html: string) {
  let out = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) out += JSON.parse(m[1]!);
  return out;
}

// Pull the JSON array that follows `"key":[` out of a larger blob, by bracket matching.
function extractJsonArray(blob: string, key: string): any[] | null {
  const at = blob.indexOf(`"${key}":[`);
  if (at < 0) return null;
  const start = at + key.length + 3;
  let depth = 0;
  let inString = false;
  for (let i = start; i < blob.length; i++) {
    const c = blob[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (--depth === 0) return JSON.parse(blob.slice(start, i + 1));
    }
  }
  return null;
}

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

// mtgin.kyiv.ua — Next.js; the result grid's props carry structured items:
//   { href, name, image, printings, copies, price, language: "en", finish: "nonfoil"|"foil"|…, set_name, collector_number }
// A tile with printings > 1 is a summary linking to the card's all-versions page, priced "from".
// Falls back to scraping the rendered HTML if the payload shape changes.
export function parseGin(html: string): CardResult[] {
  const base = "https://mtgin.kyiv.ua";
  let items: any[] | null = null;
  try {
    items = extractJsonArray(readNextFlight(html), "items");
  } catch {}
  if (!items) return parseGinHtml(html);

  return items
    .filter((i) => i?.href && i?.name)
    .map((i) => {
      const many = (i.printings ?? 1) > 1;
      const edition = !many && i.set_name ? ` — ${i.set_name}${i.collector_number ? ` #${i.collector_number}` : ""}` : "";
      return {
        shop: "gin" as const,
        name: `${i.name}${edition}`,
        url: abs(base, i.href)!,
        image: abs(base, i.image),
        price: typeof i.price === "number" ? i.price : null,
        artSeries: !many && /art series/i.test(i.set_name ?? ""),
        fromPrice: many || undefined,
        printings: many ? i.printings : undefined,
        stock: typeof i.copies === "number" ? i.copies : undefined,
        // per-printing details only make sense when the tile is one printing
        foil: !many && i.finish ? i.finish !== "nonfoil" : undefined,
        language: many ? undefined : languageCode(i.language),
      };
    });
}

function parseGinHtml(html: string): CardResult[] {
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
    fromPrice: true, // min_price across the product's offers/conditions
    language: languageCode(p.language),
    // property_set says which finishes the printing exists in, not which copy is listed — only certain when foil-only
    foil: p.property_set?.foil === "true" && p.property_set?.nonfoil === "false" ? true : undefined,
  }));
}

const CONDITIONS: Record<string, string> = {
  mint: "M", near_mint: "NM", excellent: "EX", lightly_played: "LP", good: "GD", moderately_played: "MP",
  played: "PL", heavily_played: "HP", poor: "PO", damaged: "DMG",
};

// paytowin.club — card auctions, via the site's public JSON API (api.paytowin.club/auctions?q=…&game=magic).
// Titles are free text written by sellers ("Raucous Theater #266", "4х Viper"); photos are the seller's own.
export function parsePaytowin(json: any): CardResult[] {
  const items: any[] = json?.items ?? [];
  return items
    .filter((a) => a.status === "live")
    .map((a) => {
      const currentBid = typeof a.current_high_uah === "number" ? a.current_high_uah : null;
      return {
        shop: "paytowin" as const,
        name: String(a.title ?? "").trim(),
        url: `https://paytowin.club/a/${a.id}`,
        image: a.photos?.[0]?.urls?.medium ?? a.photos?.[0]?.urls?.thumb ?? null,
        price: currentBid ?? a.starting_price_uah ?? null,
        foil: a.foil === true || undefined,
        language: languageCode(a.language),
        condition: CONDITIONS[a.condition as string],
        auction: {
          currentBid,
          startingPrice: a.starting_price_uah,
          buyNow: typeof a.buy_now_uah === "number" ? a.buy_now_uah : null,
          endsAt: a.end_time,
          bids: a.bid_count ?? 0,
        },
      };
    });
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
          fromPrice: true, // "від …" — cheapest of the printing's offers
          stock: Number(text.join(" ").match(/у продажу\s*(\d+)\s*шт/)?.[1]) || undefined,
          foil: finish && /foil/i.test(finish) ? true : undefined,
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
          fromPrice: /від/.test(block) || undefined,
        },
      ];
    });
}
