import { abs, decodeEntities, parsePrice } from './helpers';
import type { CardResult } from '../../shops';

// manavaultstore.com/cards/versions?name=<exact name> — every printing of one card, one tile each:
//   <a class="group flex flex-col rounded-xl border …" href="/cards/<scryfall id>">
//     <img alt="Sol Ring" src="/api/card-img/front/…webp">
//     <p><img set-icon/>Outlaws of Thunder Junction Commander</p> <p>OTC · №267</p> <p>Borderless?</p>
//     <p>у продажу 1 шт. · від 100 ₴</p>   — or "немає в продажу" (not for sale), which we drop
export function parseManavaultVersions(html: string): CardResult[] {
    const base = 'https://manavaultstore.com';
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
            const card = decodeEntities(
                block.match(/<img alt="([^"]+)"/)?.[1] ?? ''
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
                    image: abs(
                        base,
                        block.match(/<img alt="[^"]*"[^>]*src="([^"]+)"/)?.[1]
                    ),
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

// manavaultstore.com — server-rendered Next.js, one <a class="group flex flex-col" href="/cards/<scryfall id>"> per card.
export function parseManavault(html: string): CardResult[] {
    const base = 'https://manavaultstore.com';
    return html
        .split('<a class="group flex flex-col" href="')
        .slice(1)
        .flatMap((block) => {
            const href = block.slice(0, block.indexOf('"'));
            if (!href.startsWith('/cards/')) return [];
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
                    price: parsePrice(block.match(/([\d\s]+)\s*₴/)?.[1]),
                    fromPrice: /від/.test(block) || undefined
                }
            ];
        });
}
