import { useEffect, useRef, useState } from 'react';
import type { CardEntry } from '@/decklist';
import type { SearchResult, SearchUpdate } from '@/search-result';

// One entry per searched card, in list order. The whole list goes in one request (or a few, for a long list), and
// the server streams each card's result each time one of its shops finishes, so sections fill in as their shops
// answer instead of waiting for the slowest one. `result` can be partial: `result.pending` lists the shops still
// searching.
export type SearchEntry = {
    card: string;
    count: number; // copies wanted, from the list's quantity
    result: SearchResult | null;
};

export const isComplete = (entry: SearchEntry) =>
    entry.result !== null && !entry.result.pending?.length;

// Cards per request: the server's MAX_CARDS_PER_REQUEST. The server paces each shop itself (see ShopLimits in
// search-route.ts), so a list is sent whole: batched shops (MTGin, Nerdik, Mana Vault) then look it all up at once.
const CARDS_PER_REQUEST = 100;

// The first few cards go in a request of their own, sent before the rest, so they reach the name lookup and the
// batched shops first and the top of the list fills in sooner.
const FIRST_REQUEST_CARDS = 2;

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

// Searches a list of cards in one request, calling `onResult` with every snapshot the server streams for card `i`.
// Each card's last call has its complete result; a failure becomes a card-level error on every card not yet
// complete, so every card always ends complete.
async function searchCards(
    cards: string[],
    signal: AbortSignal,
    onResult: (i: number, result: SearchResult) => void
) {
    const last: (SearchResult | null)[] = cards.map(() => null);
    const fail = (message: string) =>
        cards.forEach((card, i) => {
            const r = last[i];
            if (r && !r.pending?.length) return;
            onResult(i, {
                card: r?.card ?? card,
                typed: r?.typed,
                links: r?.links ?? [],
                errors: [...(r?.errors ?? []), { message }]
            });
        });
    try {
        const res = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cards }),
            signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await readUpdates(res, ({ index, result }) => {
            last[index] = result;
            onResult(index, result);
        });
        // the stream ended before every card did (server restart, dropped connection)
        fail('connection closed');
    } catch (err) {
        if (signal.aborted) throw err;
        console.error('search failed', err);
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
        // the first FIRST_REQUEST_CARDS cards, then the rest CARDS_PER_REQUEST at a time
        const ranges: [number, number][] = [];
        for (let start = 0; start < cards.length;) {
            const end = Math.min(
                cards.length,
                start + (start === 0 ? FIRST_REQUEST_CARDS : CARDS_PER_REQUEST)
            );
            ranges.push([start, end]);
            start = end;
        }
        // sent in list order, one right after another: the first request's names reach the name lookup's queue first
        const send = (k: number) => {
            const range = ranges[k];
            if (!range) return;
            const [start, end] = range;
            const names = cards.slice(start, end).map((c) => c.name);
            searchCards(names, controller.signal, (i, result) => {
                if (controller.signal.aborted) return;
                setEntries(
                    (prev) =>
                        prev &&
                        prev.map((e, j) =>
                            j === start + i ? { ...e, result } : e
                        )
                );
            }).catch(() => {}); // aborted
            send(k + 1);
        };
        send(0);
        return true;
    }

    return { entries, submitting, search };
}
