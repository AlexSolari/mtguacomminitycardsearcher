// Turns a dropped/uploaded deck file into card names — entirely client-side. Supported:
//   • text exports (.txt/.dec — MTGGoldfish, Arena, MTGO): handled by parseCardList
//   • MTGO .dek (XML): <Cards CatID="…" Quantity="4" Sideboard="false" Name="Lightning Bolt" />
//   • CSV (Moxfield, Deckbox, spreadsheets): the column headed "Name" / "Card Name" / "Card"
import { parseCardList } from './decklist';

const MAX_BYTES = 1_000_000;

export class DeckFileError extends Error {}

export async function deckFileToNames(file: File): Promise<string[]> {
    if (file.size > MAX_BYTES)
        throw new DeckFileError(`${file.name}: файл завеликий`);
    const text = await file.text();
    if (text.includes('\u0000'))
        throw new DeckFileError(`${file.name}: це не текстовий файл`);
    return deckTextToNames(text, file.name);
}

export function deckTextToNames(text: string, fileName = ''): string[] {
    const head = text.trimStart();
    if (
        /\.dek$/i.test(fileName) ||
        head.startsWith('<?xml') ||
        /<Cards\b/.test(head)
    )
        return fromDek(text);
    if (/\.csv$/i.test(fileName) || looksLikeCsv(head)) {
        const names = fromCsv(text);
        if (names) return names;
    }
    return parseCardList(text).names;
}

const decodeXml = (s: string) =>
    s
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

function fromDek(xml: string): string[] {
    const lines = [...xml.matchAll(/<Cards\b[^>]*\bName="([^"]+)"/g)].map((m) =>
        decodeXml(m[1]!)
    );
    return parseCardList(lines.join('\n')).names; // dedupe + same cleanup as pasted lists
}

// A CSV export starts with a header row that has a name column and at least one comma.
const NAME_HEADER = /^(name|card ?name|card)$/i;
function looksLikeCsv(head: string) {
    const first = head.split(/\r?\n/, 1)[0] ?? '';
    return (
        first.includes(',') &&
        splitCsvRow(first).some((c) => NAME_HEADER.test(c.trim()))
    );
}

function fromCsv(text: string): string[] | null {
    const rows = text.split(/\r?\n/).filter((r) => r.trim());
    const header = splitCsvRow(rows[0] ?? '').map((c) => c.trim());
    const col = header.findIndex((c) => NAME_HEADER.test(c));
    if (col < 0) return null;
    const names = rows.slice(1).map((r) => splitCsvRow(r)[col]?.trim() ?? '');
    return parseCardList(names.join('\n')).names;
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
