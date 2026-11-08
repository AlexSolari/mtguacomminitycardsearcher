import { abs, decodeEntities, parsePrice } from '../helpers';
import type { CardResult } from '../../../search-result';

const ROW =
    '<div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm';
const BADGES = '<span class="inline-flex flex-wrap items-center gap-1.5">';

// The text pieces of a chunk of markup, entities decoded.
const texts = (html: string) =>
    html
        .split(/<[^>]+>/)
        .map((s) => decodeEntities(s).trim())
        .filter(Boolean);

// manavaultstore.com/cards/versions?name=<exact name>&view=offers — every offer of every printing of one card,
// cheapest first, one row each:
//   <h1 …>Counterspell<!-- --> <span>mana symbols</span></h1>
//   <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm sm:grid …">
//     <a class="flex min-w-56 …" href="/cards/<scryfall id>">
//       <img src="/api/card-img/front/<id>-160.webp?v=5" srcSet="…-160.webp?v=5 1x, …-320.webp?v=5 2x" alt="">
//       <span><span><img set-icon/>Strixhaven Mystical Archive</span><span>№<!-- -->15</span>
//         <span …>Borderless · Showcase</span></span>           — the finish, when the printing has one
//     </a>
//     <div><a href="/users/…">seller</a> city, rating</div>
//     <span class="inline-flex flex-wrap items-center gap-1.5">
//       <span title="Near Mint — як із бустера" …>NM</span> <span title="Англійська" …>EN</span> <span …>FOIL</span>
//     </span>                                                  — no FOIL badge on a non-foil copy
//     <span …>2<!-- --> шт.</span> <span …>770 ₴<span …>−16% від ринку</span></span>
//     <form …>add to cart</form>
// Offers of one printing alike in finish, language, condition and price become one result with their stock added
// up, so no two results share both a URL and a price for the same kind of copy.
export function parseManavaultOffers(html: string, base: string): CardResult[] {
    const page = html.replace(/<!-- -->/g, '');
    const card = texts(page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')[0];
    if (!card) return [];

    const merged = new Map<string, CardResult>();
    for (const chunk of page.split(ROW).slice(1)) {
        const row = chunk.slice(0, chunk.indexOf('<form'));
        const link = row.match(
            /<a\b[^>]*href="(\/cards\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/
        );
        const at = row.indexOf(BADGES);
        const offer = row.slice(at);
        const stock = Number(offer.match(/>(\d+)\s*шт\./)?.[1]);
        if (!link || at < 0 || !(stock > 0)) continue;

        // the printing: "Strixhaven Mystical Archive", "№15", then its finish, if any
        const printing = texts(link[2]!);
        const numIdx = printing.findIndex((s) => s.startsWith('№'));
        const set = numIdx > 0 ? printing[numIdx - 1] : undefined;
        const number = printing[numIdx]?.slice(1).trim();
        const img = link[2]!.match(/<img\b[^>]*>/)?.[0] ?? '';
        // the largest of the srcSet's sizes, else src
        const image =
            img.match(/srcSet="[^"]*?(\S+)\s+\d+x"/)?.[1] ??
            img.match(/\bsrc="([^"]+)"/)?.[1];

        const badges = [...offer.matchAll(/<span([^>]*)>([^<]+)<\/span>/g)].map(
            ([, attrs, text]) => ({
                title: decodeEntities(
                    attrs!.match(/title="([^"]*)"/)?.[1] ?? ''
                ),
                text: decodeEntities(text!).trim()
            })
        );
        // the condition's title explains the grade ("Near Mint — …"); the language's names it ("Англійська")
        const condition = badges.find((b) => b.title.includes(' — '))?.text;
        const language = badges.find(
            (b) =>
                b.title &&
                !b.title.includes(' — ') &&
                /^[A-Z]{2,3}$/.test(b.text)
        )?.text;
        const finish = badges.find((b) => /^(foil|etched)$/i.test(b.text));
        const etched = /etched/i.test(finish?.text ?? '');
        // the printing's own finish, e.g. "Borderless" or "Ripple Foil" (a foil-only printing, with no FOIL badge)
        const treatment = numIdx >= 0 ? printing[numIdx + 1] : undefined;

        // "Counterspell — Strixhaven Mystical Archive #15, Borderless · Showcase": the edition goes after " — ",
        // where isExactMatch cuts (the same shape as Nerdik's names)
        const edition = [
            set && number ? `${set} #${number}` : set,
            treatment,
            etched && 'Etched'
        ]
            .filter(Boolean)
            .join(', ');
        const result: CardResult = {
            shop: 'manavault',
            name: edition ? `${card} — ${edition}` : card,
            url: abs(base, link[1])!,
            image: abs(base, image),
            price: parsePrice(offer.match(/>([\d\s  ]+)₴/)?.[1]),
            stock,
            foil: !!finish || /foil/i.test(treatment ?? ''),
            language,
            condition
        };
        const key = [
            result.url,
            result.name,
            result.foil,
            language,
            condition,
            result.price
        ].join('|');
        const same = merged.get(key);
        if (same) same.stock! += stock;
        else merged.set(key, result);
    }
    return [...merged.values()];
}

// manavaultstore.com/cards?q=… — server-rendered Next.js, one tile per card:
//   <a class="group flex flex-col" href="/cards/versions?name=Sol%20Ring">   (or /cards/<scryfall id> for a single printing)
//     <img src="/api/card-img/front/…webp" …> <h3 …>Sol Ring</h3> <p>6 версій · оберіть свою</p>
//     <strong …>78 – 3 636 ₴</strong>   — a range across printings, or "від 16 ₴", or one price
export function parseManavault(html: string, base: string): CardResult[] {
    return html
        .split('<a class="group flex flex-col" href="')
        .slice(1)
        .flatMap((block) => {
            const href = block.slice(0, block.indexOf('"'));
            if (!href.startsWith('/cards/')) return [];
            const priceText =
                block.match(/<strong[^>]*>([^<]*₴)<\/strong>/)?.[1] ?? '';
            return [
                {
                    shop: 'manavault' as const,
                    name: decodeEntities(
                        block.match(/<h3[^>]*>([^<]+)<\/h3>/)?.[1] ?? ''
                    ),
                    url: abs(base, href)!,
                    image: abs(
                        base,
                        block.match(/<img[^>]*src="([^"]+)"/)?.[1]
                    ),
                    // the low end of a range is the cheapest printing
                    price: parsePrice(priceText.match(/\d[\d\s  ]*/)?.[0]),
                    fromPrice:
                        /від/.test(block) ||
                        priceText.includes('–') ||
                        undefined
                }
            ];
        });
}
