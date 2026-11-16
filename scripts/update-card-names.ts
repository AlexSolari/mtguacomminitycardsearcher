// Rebuilds src/server/card-names.json, the card names the name resolver looks typed names up in before asking
// Scryfall (src/server/card-index.ts), from Scryfall's oracle-cards bulk file (one entry per card).
//   bun scripts/update-card-names.ts                  downloads the latest (one API request, then a ~160 MB file
//                                                     from data.scryfall.io, which isn't rate-limited)
//   bun scripts/update-card-names.ts <file.json[l]>   reads a downloaded copy (JSON array or one card per line)
// Run it after each set release: until then, the new set's names fall back to Scryfall's API.
import type { CardNameEntry } from '../src/server/card-index';

// Scryfall rejects requests without these
const HEADERS = { 'User-Agent': 'searcher/0.1', Accept: 'application/json' };

// The subset of the bulk file's card objects we read.
type BulkCard = {
    name: string;
    layout: string;
    set_type: string;
    card_faces?: { name: string }[];
};

// Not cards anyone buys singles of by these names: art cards ("Ragavan // Ragavan"), tokens and emblems, whose
// names ("Demon", "Treasure") would shadow real cards'.
const SKIP_LAYOUTS = new Set([
    'art_series',
    'token',
    'double_faced_token',
    'emblem'
]);

// Arena-only designs and rebalanced copies ("A-Ragavan, Nimble Pilferer"): never on paper, and they'd make the
// paper card's name ambiguous. Not every card whose listed printing is digital: Tundra's is an MTGO one.
const SKIP_SET_TYPES = new Set(['alchemy']);

async function download(): Promise<{ text: string; source: string }> {
    const res = await fetch('https://api.scryfall.com/bulk-data/oracle-cards', {
        headers: HEADERS
    });
    if (!res.ok) throw new Error(`Scryfall bulk-data: HTTP ${res.status}`);
    const { download_uri, updated_at } = (await res.json()) as {
        download_uri: string;
        updated_at: string;
    };
    console.log(`downloading ${download_uri}`);
    const file = await fetch(download_uri, { headers: HEADERS });
    if (!file.ok) throw new Error(`Scryfall bulk file: HTTP ${file.status}`);
    return { text: await file.text(), source: `oracle-cards ${updated_at}` };
}

async function read(path: string): Promise<{ text: string; source: string }> {
    const name = path.split(/[\\/]/).pop()!;
    return { text: await Bun.file(path).text(), source: name };
}

const arg = process.argv[2];
const { text, source } = arg ? await read(arg) : await download();
const all: BulkCard[] = text.trimStart().startsWith('[')
    ? JSON.parse(text)
    : text
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));

const cards: CardNameEntry[] = all
    .filter(
        (c) => !SKIP_LAYOUTS.has(c.layout) && !SKIP_SET_TYPES.has(c.set_type)
    )
    .map((c) =>
        c.card_faces?.length
            ? [c.name, ...c.card_faces.map((f) => f.name)]
            : c.name
    )
    .sort((a, b) => {
        const [x, y] = [a, b].map((e) => (typeof e === 'string' ? e : e[0]!));
        return x! < y! ? -1 : x! > y! ? 1 : 0;
    });

// A card per line, sorted, so a refresh's diff shows the cards it added
const body = `{\n"source": ${JSON.stringify(source)},\n"cards": [\n${cards
    .map((c) => JSON.stringify(c))
    .join(',\n')}\n]\n}\n`;
const out = new URL('../src/server/card-names.json', import.meta.url);
await Bun.write(out, body);
console.log(
    `card-names.json  ${cards.length} cards (of ${all.length})  ${(body.length / 1024).toFixed(0)} KB`
);
