import { normalize } from './matching';

// Parses a pasted card list into unique cards with counts. Accepts plain names (one per line) as well as
// common decklist exports — MTGGoldfish / MTGO (.txt) and MTG Arena:
//
//   Deck                          ← section headers are skipped
//   4 Lightning Bolt              ← quantity ("4", "4x") becomes the count; 1 without one; repeats add up
//   1 Sol Ring (C21) 263          ← Arena set code + collector number stripped
//   1 Fire // Ice (MH3) 290 *F*   ← foil marker stripped, split names kept
//   SB: 2 Pyroblast               ← MTGO sideboard prefix stripped
//
// Links (e.g. an MTGGoldfish deck URL) can't be resolved here — they're returned separately so the UI can
// explain that the deck text needs to be pasted instead.

const SECTION_HEADER =
    /^(deck|main ?deck|sideboard|side ?board|commander|companion|maybeboard|considering|about|name\b.*)$/i;
const URL = /^https?:\/\/\S+$/i;

export type CardEntry = { name: string; count: number };
export type ParsedList = { cards: CardEntry[]; links: string[] };

export function parseCardList(text: string): ParsedList {
    const cards = new Map<string, CardEntry>(); // normalized name → entry, in first-seen order
    const links: string[] = [];

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (
            !line ||
            line.startsWith('//') ||
            line.startsWith('#') ||
            SECTION_HEADER.test(line)
        )
            continue;
        if (URL.test(line)) {
            links.push(line);
            continue;
        }

        const rest = line.replace(/^SB:\s*/i, '');
        const quantity = rest.match(/^(\d+)\s*x?\s+/i);
        const name = rest
            .slice(quantity?.[0].length ?? 0)
            .replace(/\s+\*[A-Z]+\*$/i, '')
            .replace(/\s+\([A-Z0-9]{2,6}\)(\s+[\w★-]+)?$/i, '')
            .trim();
        // the server's matching key, so "Æther Vial" and "Aether Vial" are one card; a name with nothing
        // searchable ("???") is dropped, as the server would drop it
        const key = normalize(name);
        if (!key) continue;

        const count = Number(quantity?.[1] ?? 1) || 1;
        const seen = cards.get(key);
        if (seen) seen.count += count;
        else cards.set(key, { name, count });
    }

    return { cards: [...cards.values()], links };
}

// The reverse, for filling the textarea from imported files: "4 Lightning Bolt", one per line.
export const formatCardList = (cards: CardEntry[]) =>
    cards.map((c) => `${c.count} ${c.name}`).join('\n');
