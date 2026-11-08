import { abs, decodeEntities, parsePrice } from './helpers';
import type { CardResult } from '../../search-result';

// manavaultstore.com/cards/versions?name=<exact name> — every printing of one card, one tile each:
//   <a class="group flex flex-col rounded-xl border …" href="/cards/<scryfall id>">
//     <img src="/api/card-img/front/…webp" srcSet="…" alt="Sol Ring">   — attribute order varies, so read each separately
//     <p><img set-icon/>Outlaws of Thunder Junction Commander</p> <p>OTC · №267</p> <p>Borderless?</p>
//     <p>у продажу 1 шт. · від 100 ₴</p>   — or "немає в продажу" (not for sale), which we drop
export function parseManavaultVersions(
    html: string,
    base: string
): CardResult[] {
    return html
        .split('<a class="group flex flex-col rounded-xl border')
        .slice(1)
        .flatMap((chunk) => {
            const block = chunk.slice(0, chunk.indexOf('</a>'));
            const href = block.match(/href="(\/cards\/[^"]+)"/)?.[1];
            if (!href || !block.includes('у продажу')) return [];

            const text = block
                .replace(/<!-- -->/g, '')
                .split(/<[^>]+>/)
                .map((s) => decodeEntities(s).trim())
                .filter(Boolean);
            const numIdx = text.findIndex((s) => s.includes('№'));
            const set = numIdx > 0 ? text[numIdx - 1] : undefined;
            const number = text[numIdx]?.match(/№\s*(\S+)/)?.[1];
            const finish =
                text[numIdx + 1] && !text[numIdx + 1]!.includes('продажу')
                    ? text[numIdx + 1]
                    : undefined;
            const img = block.match(/<img\b[^>]*>/)?.[0] ?? '';
            const card = decodeEntities(
                img.match(/\balt="([^"]*)"/)?.[1] ?? ''
            );

            // "Sol Ring — Outlaws of Thunder Junction Commander #267, Borderless" (same shape as Nerdik's names)
            const edition = [set && number ? `${set} #${number}` : set, finish]
                .filter(Boolean)
                .join(', ');
            return [
                {
                    shop: 'manavault' as const,
                    name: edition ? `${card} — ${edition}` : card,
                    url: abs(base, href)!,
                    image: abs(base, img.match(/\bsrc="([^"]+)"/)?.[1]),
                    fromPrice: true, // "від …" — cheapest of the printing's offers
                    stock:
                        Number(
                            text.join(' ').match(/у продажу\s*(\d+)\s*шт/)?.[1]
                        ) || undefined,
                    foil: finish && /foil/i.test(finish) ? true : undefined,
                    price: parsePrice(
                        text.join(' ').match(/від\s*([\d\s  ]+)\s*₴/)?.[1]
                    )
                }
            ];
        });
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
