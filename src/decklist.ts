// Parses a pasted card list into unique card names. Accepts plain names (one per line) as well as
// common decklist exports — MTGGoldfish / MTGO (.txt) and MTG Arena:
//
//   Deck                          ← section headers are skipped
//   4 Lightning Bolt              ← quantity stripped ("4", "4x")
//   1 Sol Ring (C21) 263          ← Arena set code + collector number stripped
//   1 Fire // Ice (MH3) 290 *F*   ← foil marker stripped, split names kept
//   SB: 2 Pyroblast               ← MTGO sideboard prefix stripped
//
// Links (e.g. an MTGGoldfish deck URL) can't be resolved here — they're returned separately so the UI can
// explain that the deck text needs to be pasted instead.

const SECTION_HEADER =
    /^(deck|main ?deck|sideboard|side ?board|commander|companion|maybeboard|considering|about|name\b.*)$/i;
const URL = /^https?:\/\/\S+$/i;

export type ParsedList = { names: string[]; links: string[] };

export function parseCardList(text: string): ParsedList {
    const seen = new Set<string>();
    const names: string[] = [];
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

        const name = line
            .replace(/^SB:\s*/i, '')
            .replace(/^\d+\s*x?\s+/i, '')
            .replace(/\s+\*[A-Z]+\*$/i, '')
            .replace(/\s+\([A-Z0-9]{2,6}\)(\s+[\w★-]+)?$/i, '')
            .trim();

        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        names.push(name);
    }

    return { names, links };
}
