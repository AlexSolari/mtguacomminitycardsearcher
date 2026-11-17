import { decodeEntities } from '../../parsers/helpers';
import {
    mergeRows,
    type Finish,
    type ListCard,
    type ParsedList
} from '../list-card';

// mtggoldfish.com/proxies/new?id=<deck>: the proxy printer, prefilled with the deck. The deck's own pages
// (/deck/<id>, /deck/download/<id>) are behind a Cloudflare challenge; this one isn't. One line per printing:
//
//   <textarea name="deck" id="deck" class="form-control deck-pricer-deck-input">
//   1 Sacred Foundry &lt;retro&gt; [RVR]     ← treatment in <…>, set in […]
//   2 Boseiju, Who Endures [NEO]
//   1 Lotus Bloom [PRM-PRE] (F)              ← (F): foil; PRM-…: Goldfish's promo groups, not real set codes
//   1 Gaea&#39;s Will &lt;retro&gt; [MH2] (FE)  ← (FE): foil-etched
//   1 Anger                                  ← a deck built without printings has neither
//   sideboard                                ← section headers; every section counts
//   </textarea>
//
// The page has no deck title. A missing deck is a 404, which the client reports; a page without the deck field
// (a redesign) is null; a deck with no cards is an empty list.
export const DECK_FIELD =
    /<textarea\b[^>]*\bid="deck"[^>]*>([^<]*)<\/textarea>/;
// The finish marker is any short upper-case code in brackets, so one we don't know yet ("(E)"?) doesn't end up in
// the card's name; only the known ones set the finish. No card name ends that way ("B.F.M. (Big Furry Monster)").
const LINE =
    /^(\d+)x?\s+(.+?)(?:\s+<([^<>]+)>)?(?:\s+\[([^[\]]+)\])?(?:\s+\(([A-Z]{1,3})\))?$/;
const FINISHES: Record<string, Finish> = { F: 'foil', FE: 'etched' };

export function parseMtggoldfish(html: string): ParsedList | null {
    const field = html.match(DECK_FIELD);
    if (!field) return null;
    const cards: ListCard[] = [];
    for (const raw of decodeEntities(field[1]!).split(/\r?\n/)) {
        const line = raw.match(LINE);
        const quantity = Number(line?.[1]);
        if (!line || quantity < 1) continue;
        const set = line[4]?.trim();
        const promo = !!set && /^PRM-/i.test(set);
        cards.push({
            name: line[2]!.trim(),
            quantity,
            finish: FINISHES[line[5] ?? ''] ?? 'nonfoil',
            // a promo group names no printing, so the card is priced by name alone; it's still shown as a promo
            ...(set && !promo && { set: set.toLowerCase() }),
            ...((line[3] || promo) && {
                variant: line[3]?.trim() ?? 'promo'
            })
        });
    }
    return { cards: mergeRows(cards) };
}
