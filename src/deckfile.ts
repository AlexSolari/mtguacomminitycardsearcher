// Turns a dropped/uploaded deck file into cards with counts — entirely client-side. Supported:
//   • text exports (.txt/.dec — MTGGoldfish, Arena, MTGO): handled by parseCardList
//   • MTGO .dek (XML): <Cards CatID="…" Quantity="4" Sideboard="false" Name="Lightning Bolt" />
//   • CSV (Moxfield, Deckbox, spreadsheets): the column headed "Name" / "Card Name" / "Card",
//     counts from "Count" / "Quantity" / "Qty" when there is one
import { parseCardList, type CardEntry } from './decklist';

const MAX_BYTES = 1_000_000;

export class DeckFileError extends Error {}

export async function deckFileToCards(file: File): Promise<CardEntry[]> {
    if (file.size > MAX_BYTES)
        throw new DeckFileError(`${file.name}: файл завеликий`);
    const text = await file.text();
    if (text.includes('\u0000'))
        throw new DeckFileError(`${file.name}: це не текстовий файл`);
    return deckTextToCards(text, file.name);
}

export function deckTextToCards(text: string, fileName = ''): CardEntry[] {
    const head = text.trimStart();
    if (
        /\.dek$/i.test(fileName) ||
        head.startsWith('<?xml') ||
        /<Cards\b/.test(head)
    )
        return fromDek(text);
    if (/\.csv$/i.test(fileName) || looksLikeCsv(head)) {
        const cards = fromCsv(text);
        if (cards) return cards;
    }
    return parseCardList(text).cards;
}

const decodeXml = (s: string) =>
    s
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

// Each card becomes a "4 Lightning Bolt" line for parseCardList: it dedupes (main + sideboard add up) and
// applies the same cleanup as pasted lists.
const line = (name: string, quantity: string | undefined) =>
    quantity && /^\d+$/.test(quantity) ? `${quantity} ${name}` : name;

function fromDek(xml: string): CardEntry[] {
    const lines = [...xml.matchAll(/<Cards\b[^>]*>/g)].flatMap(([tag]) => {
        const name = tag.match(/\bName="([^"]+)"/)?.[1];
        const quantity = tag.match(/\bQuantity="([^"]+)"/)?.[1];
        return name ? [line(decodeXml(name), quantity)] : [];
    });
    return parseCardList(lines.join('\n')).cards;
}

// A CSV export starts with a header row that has a name column and at least one comma.
const NAME_HEADER = /^(name|card ?name|card)$/i;
const COUNT_HEADER = /^(count|quantity|qty)$/i;
function looksLikeCsv(head: string) {
    const first = head.split(/\r?\n/, 1)[0] ?? '';
    return (
        first.includes(',') &&
        splitCsvRow(first).some((c) => NAME_HEADER.test(c.trim()))
    );
}

function fromCsv(text: string): CardEntry[] | null {
    const rows = text.split(/\r?\n/).filter((r) => r.trim());
    const header = splitCsvRow(rows[0] ?? '').map((c) => c.trim());
    const nameCol = header.findIndex((c) => NAME_HEADER.test(c));
    if (nameCol < 0) return null;
    const countCol = header.findIndex((c) => COUNT_HEADER.test(c));
    const lines = rows.slice(1).flatMap((r) => {
        const cells = splitCsvRow(r);
        const name = cells[nameCol]?.trim();
        return name ? [line(name, cells[countCol]?.trim())] : [];
    });
    return parseCardList(lines.join('\n')).cards;
}

// Minimal RFC 4180 row split: commas, "quoted, fields" and "" escapes. (Multi-line cells aren't a thing in deck exports.)
function splitCsvRow(row: string): string[] {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (quoted) {
            if (c === '"' && row[i + 1] === '"') ((cell += '"'), i++);
            else if (c === '"') quoted = false;
            else cell += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') (cells.push(cell), (cell = ''));
        else cell += c;
    }
    cells.push(cell);
    return cells;
}
