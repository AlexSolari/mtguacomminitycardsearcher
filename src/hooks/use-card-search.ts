import { useEffect, useRef, useState } from 'react';
import type { CardEntry } from '@/decklist';
import type { SearchResult, SearchUpdate } from '@/search-result';

// One entry per searched card, in list order. Each card is fetched by its own request, so sections fill in
// as soon as their card is done instead of waiting for the slowest one. Within a card, the server streams the
// result each time a shop finishes, so `result` can be partial: `result.pending` lists the shops still searching.
export type SearchEntry = {
    card: string;
    count: number; // copies wanted, from the list's quantity
    result: SearchResult | null;
};

export const isComplete = (entry: SearchEntry) =>
    entry.result !== null && !entry.result.pending?.length;

// Cards in flight at once. The server's per-shop request queues are shared by every user and capped
// (see ShopClient), so one big deck mustn't fill them. The shops' rate limit caps throughput anyway, so a
// handful in flight finishes a deck about as fast as all of them at once.
const CONCURRENT_CARDS = 6;

// Cards in one search, as the server's MAX_CARDS_PER_REQUEST. A shared link fills in the list and searches it on
// opening, so without a cap whoever writes the link decides how much work the opener's browser starts against the
// shops; the cap also covers lists typed or pasted in.
export const MAX_SEARCH_CARDS = 100;

// Reads the NDJSON lines of /api/search as they arrive, passing each update on. Resolves once the stream ends.
async function readUpdates(
    res: Response,
    onUpdate: (update: SearchUpdate) => void
) {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += value;
        const lines = buffered.split('\n');
        buffered = lines.pop()!;
        for (const line of lines)
            if (line.trim()) onUpdate(JSON.parse(line) as SearchUpdate);
    }
    if (buffered.trim()) onUpdate(JSON.parse(buffered) as SearchUpdate);
}

// Searches one card, calling `onResult` with every snapshot the server streams. The last call has the complete
// result; a failure becomes a result with a card-level error, so the card always ends complete.
async function searchCard(
    card: string,
    signal: AbortSignal,
    onResult: (result: SearchResult) => void
) {
    // `as`: assigned in a callback, which TypeScript's narrowing doesn't see
    let last = null as SearchResult | null;
    const fail = (message: string) =>
        onResult({
            card: last?.card ?? card,
            typed: last?.typed,
            links: last?.links ?? [],
            errors: [...(last?.errors ?? []), { message }]
        });
    try {
        const res = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cards: [card] }),
            signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await readUpdates(res, ({ result }) => {
            last = result;
            onResult(result);
        });
        if (!last) onResult({ card, links: [], errors: [] });
        // the stream ended before the card did (server restart, dropped connection)
        else if (last.pending?.length) fail('connection closed');
    } catch (err) {
        if (signal.aborted) throw err;
        console.error(`search for "${card}" failed`, err);
        fail((err as Error).message);
    }
}

export function useCardSearch() {
    const [entries, setEntries] = useState<SearchEntry[] | null>(null);
    const searchRef = useRef<AbortController | null>(null);

    const submitting = entries?.some((e) => !isComplete(e)) ?? false;

    // Leaving the page cancels the search, which also frees its place in the server's shop queues.
    useEffect(() => () => searchRef.current?.abort(), []);

    // Returns whether a search was started. A search started while another is running replaces it.
    function search(cards: CardEntry[]) {
        if (cards.length === 0 || cards.length > MAX_SEARCH_CARDS) return false;

        // cancel the previous search: its pending requests, and any responses still on their way
        searchRef.current?.abort();
        const controller = new AbortController();
        searchRef.current = controller;

        setEntries(
            cards.map(({ name, count }) => ({
                card: name,
                count,
                result: null
            }))
        );
        // CONCURRENT_CARDS workers take the next card in list order until none are left
        let next = 0;
        const work = async () => {
            while (next < cards.length) {
                const i = next++;
                await searchCard(
                    cards[i]!.name,
                    controller.signal,
                    (result) => {
                        if (controller.signal.aborted) return;
                        setEntries(
                            (prev) =>
                                prev &&
                                prev.map((e, j) =>
                                    j === i ? { ...e, result } : e
                                )
                        );
                    }
                );
            }
        };
        for (let w = 0; w < CONCURRENT_CARDS; w++) work().catch(() => {}); // aborted
        return true;
    }

    return { entries, submitting, search };
}
