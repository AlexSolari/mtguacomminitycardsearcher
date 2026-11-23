import { normalize } from '@/shared/matching';

// One card in card-names.json (written by scripts/update-card-names.ts from Scryfall's oracle-cards bulk file): its
// name, or for a card with faces, its name and then each face's.
//   "Sol Ring"
//   ["Delver of Secrets // Insectile Aberration", "Delver of Secrets", "Insectile Aberration"]
export type CardNameEntry = string | string[];
export type CardNames = { source: string; cards: CardNameEntry[] };

// A card the index found, in the shape of Scryfall's card object, so the resolver treats both alike.
export type IndexedCard = { name: string; card_faces?: { name: string }[] };

// A name a card can be found by: the whole card's (`whole`) or one face's. `id` is its place in `entries`.
type Entry = {
    id: number;
    key: string;
    words: string[];
    card: IndexedCard;
    whole: boolean;
};

// Shorter queries aren't guessed at: "otp" or "sol" fit too many cards to pick one by.
const MIN_FUZZY_LENGTH = 4;

// Typos allowed, by query length (normalized): one in a short name, two in a longer one.
const maxTypos = (length: number) => (length < 6 ? 1 : 2);

// Letter counts per name, for ruling names out of the typo search cheaply (see `find`). Characters share
// HISTOGRAM_SIZE slots by code, which only makes the bound looser.
const HISTOGRAM_SIZE = 32;

// Scryfall's card names, looked up without asking Scryfall. Answers only when one card fits; anything else (an unknown
// name, a card newer than the file, a name in another language, several cards fitting) is left to Scryfall's API.
export class CardIndex {
    private readonly entries: Entry[] = [];
    private readonly byKey = new Map<string, Entry[]>();
    // every word of every name, sorted, and the entries each is in: the word search looks up a typed word's range
    private readonly words: string[];
    private readonly byWord = new Map<string, Entry[]>();
    // `words` as one text, a word per line, and where each starts: one indexOf pass finds the words containing a
    // piece, several times faster than asking each word
    private readonly wordText: string;
    private readonly wordStarts: number[] = [];
    // by key length, for the typo search, and each entry's letter counts (HISTOGRAM_SIZE bytes per entry)
    private readonly byLength: Entry[][] = [];
    private readonly histograms: Uint8Array;

    constructor(cards: CardNameEntry[]) {
        for (const names of cards) {
            const [name, ...faces] =
                typeof names === 'string' ? [names] : names;
            const card: IndexedCard = faces.length
                ? { name: name!, card_faces: faces.map((name) => ({ name })) }
                : { name: name! };
            [name!, ...faces].forEach((n, i) => {
                const key = normalize(n);
                const entry = {
                    id: this.entries.length,
                    key,
                    words: key.split(' '),
                    card,
                    whole: i === 0
                };
                this.entries.push(entry);
                push(this.byKey, key, entry);
                for (const w of new Set(entry.words))
                    push(this.byWord, w, entry);
                (this.byLength[key.length] ??= []).push(entry);
            });
        }
        this.words = [...this.byWord.keys()].sort();
        let at = 0;
        for (const w of this.words) {
            this.wordStarts.push(at);
            at += w.length + 1;
        }
        this.wordText = this.words.join('\n');
        this.histograms = new Uint8Array(this.entries.length * HISTOGRAM_SIZE);
        for (const e of this.entries)
            histogram(e.key, this.histograms, e.id * HISTOGRAM_SIZE);
    }

    static async load(
        file: string | URL = new URL('./card-names.json', import.meta.url)
    ): Promise<{ index: CardIndex; source: string; cards: number }> {
        const data: CardNames = await Bun.file(file).json();
        return {
            index: new CardIndex(data.cards),
            source: data.source,
            cards: data.cards.length
        };
    }

    // The card `typed` names, tried in order and stopping at the first step that finds any name:
    //   the name or a face's, ignoring case and punctuation    "insectile aberration", "lim dul s vault"
    //   every word typed starts a word of the name, in order   "overlord balemurk" → Overlord of the Balemurk
    //   a typo or two                                          "lightnig bolt" → Lightning Bolt
    //   every word typed is in a word of the name, in order    "fang boss" → Greasefang, Okiba Boss
    // undefined when nothing fits or several cards do. Typos go before pieces of words: a misspelled name's words are
    // often in another name's ("on the day" is in Done for the Day, but was Own the Day).
    find(typed: string): IndexedCard | undefined {
        const q = normalize(typed);
        const exact = this.byKey.get(q);
        if (exact) return pick(exact);
        if (q.length < MIN_FUZZY_LENGTH) return undefined;
        const words = q.split(' ');
        const byWords = this.findByWords(words);
        if (byWords.length) return pick(byWords);
        const byTypos = this.findByTypos(q);
        if (byTypos.length) return pick(byTypos);
        // Not for one word: a piece of a word is in too many names ("fang": 69 cards, "ring": 626)
        return words.length > 1 ? pick(this.findInWords(words)) : undefined;
    }

    // The names each typed word starts a word of, in order. Of those, the ones starting with the first word typed
    // ("ragavan": Ragavan, Nimble Pilferer, not Rashmi and Ragavan); then, if every other one goes on from it, the
    // shortest ("sword of fire ice": Sword of Fire and Ice, not Sword of Fire and Ice and War and Peace). Not just the
    // shortest: "jace" isn't Jace Beleren.
    private findByWords(typed: string[]): Entry[] {
        // the names with a word starting with the longest word typed, the fewest to check
        const longest = typed.reduce((a, b) => (b.length > a.length ? b : a));
        const candidates = new Set<Entry>();
        for (
            let i = lowerBound(this.words, longest);
            i < this.words.length && this.words[i]!.startsWith(longest);
            i++
        )
            for (const e of this.byWord.get(this.words[i]!)!) candidates.add(e);
        const found = [...candidates].filter((e) =>
            inOrder(e.words, typed, (word, w) => word.startsWith(w))
        );
        const atStart = found.filter((e) => e.words[0]!.startsWith(typed[0]!));
        const hits = atStart.length ? atStart : found;
        if (!hits.length) return hits;
        const shortest = hits.reduce((a, b) =>
            b.key.length < a.key.length ? b : a
        ).key;
        return hits.every(
            (e) => e.key === shortest || e.key.startsWith(`${shortest} `)
        )
            ? hits.filter((e) => e.key === shortest)
            : hits;
    }

    // The names each typed word is part of a word of, in order: Scryfall's fuzzy search finds these too.
    private findInWords(typed: string[]): Entry[] {
        const longest = typed.reduce((a, b) => (b.length > a.length ? b : a));
        const candidates = new Set<Entry>();
        const text = this.wordText;
        for (let at = text.indexOf(longest); at !== -1;) {
            // the word this is in, then on from the next word
            const i = lowerBound(this.wordStarts, at + 1) - 1;
            const word = this.words[i]!;
            for (const e of this.byWord.get(word)!) candidates.add(e);
            at = text.indexOf(longest, this.wordStarts[i]! + word.length + 1);
        }
        return [...candidates].filter((e) =>
            inOrder(e.words, typed, (word, w) => word.includes(w))
        );
    }

    // The names fewest edits away, if within maxTypos.
    private findByTypos(q: string): Entry[] {
        const qHist = new Uint8Array(HISTOGRAM_SIZE);
        histogram(q, qHist, 0);
        const max = maxTypos(q.length);
        const rows = Array.from(
            { length: 3 },
            () => new Int32Array(q.length + max + 1)
        );
        let best = max;
        let closest: Entry[] = [];
        for (let len = q.length - best; len <= q.length + best; len++)
            for (const e of this.byLength[len] ?? []) {
                // An edit changes the letter counts by at most 2 (a swap by 0), so names whose counts differ more
                // than allowed are out without working out the distance.
                let diff = 0;
                const at = e.id * HISTOGRAM_SIZE;
                for (let k = 0; k < HISTOGRAM_SIZE; k++)
                    diff += Math.abs(qHist[k]! - this.histograms[at + k]!);
                if (diff > 2 * best) continue;
                const d = distance(q, e.key, best + 1, rows);
                if (d < best) [best, closest] = [d, [e]];
                else if (d === best) closest.push(e);
            }
        return closest;
    }
}

// The one card several matching names point to, if they all do. Matches on the same name keep the card that *is*
// that name: "Lightning Bolt" is Lightning Bolt, not the back face of Emeritus of Conflict. A face several cards share
// with no card of that name ("Peer Review") is ambiguous, as are different names.
function pick(hits: Entry[]): IndexedCard | undefined {
    const first = hits[0];
    if (!first) return undefined;
    if (hits.every((h) => h.card === first.card)) return first.card;
    if (hits.some((h) => h.key !== first.key)) return undefined;
    // the same name on several cards differs only in punctuation ("Clear the Mind", "Clear, the Mind"): any will do
    return hits.find((h) => h.whole)?.card;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
}

// The first index in `sorted` not before `value`
function lowerBound<T extends string | number>(sorted: T[], value: T) {
    let [lo, hi] = [0, sorted.length];
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid]! < value) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

// Does each of `typed` fit (`fits`) a word of `name`, in order, skipping any words between?
function inOrder(
    name: string[],
    typed: string[],
    fits: (word: string, typed: string) => boolean
) {
    let j = 0;
    for (const w of typed) {
        while (j < name.length && !fits(name[j]!, w)) j++;
        if (j++ >= name.length) return false;
    }
    return true;
}

function histogram(s: string, into: Uint8Array, at: number) {
    for (let i = 0; i < s.length; i++)
        into[at + (s.charCodeAt(i) % HISTOGRAM_SIZE)]!++;
}

// Edits (insert, delete, change, swap two neighbours) from `a` to `b`, or `limit` once it's clear there are at least
// that many. `rows` are three buffers longer than `b`, reused across calls.
function distance(
    a: string,
    b: string,
    limit: number,
    rows: Int32Array[]
): number {
    let [before, prev, row] = rows as [Int32Array, Int32Array, Int32Array];
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        row[0] = i;
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            let d = Math.min(
                prev[j]! + 1,
                row[j - 1]! + 1,
                prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            if (
                i > 1 &&
                j > 1 &&
                a[i - 1] === b[j - 2] &&
                a[i - 2] === b[j - 1]
            )
                d = Math.min(d, before[j - 2]! + 1);
            row[j] = d;
            if (d < rowMin) rowMin = d;
        }
        if (rowMin >= limit) return limit;
        [before, prev, row] = [prev, row, before];
    }
    return Math.min(prev[b.length]!, limit);
}
