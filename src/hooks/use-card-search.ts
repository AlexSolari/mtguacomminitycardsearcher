import { useRef, useState } from 'react';
import type { SearchResult } from '@/shops';

// One entry per searched card, in list order. Each card is fetched by its own request, so sections fill in
// as soon as their card is done instead of waiting for the slowest one.
export type SearchEntry = { card: string; result: SearchResult | null };

async function searchCard(
    card: string,
    signal: AbortSignal
): Promise<SearchResult> {
    try {
        const res = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cards: [card] }),
            signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { results: SearchResult[] };
        return data.results[0] ?? { card, links: [], errors: [] };
    } catch (err) {
        if (signal.aborted) throw err;
        console.error(`search for "${card}" failed`, err);
        return {
            card,
            links: [],
            errors: [{ message: (err as Error).message }]
        };
    }
}

export function useCardSearch() {
    const [entries, setEntries] = useState<SearchEntry[] | null>(null);
    const searchRef = useRef<AbortController | null>(null);

    const submitting = entries?.some((e) => e.result === null) ?? false;
    const finished =
        entries?.flatMap((e) => (e.result ? [e.result] : [])) ?? [];

    // Returns whether a search was started.
    function search(cards: string[]) {
        if (cards.length === 0 || submitting) return false;

        searchRef.current?.abort(); // drop any responses still in flight from a previous search
        const controller = new AbortController();
        searchRef.current = controller;

        setEntries(cards.map((card) => ({ card, result: null })));
        cards.forEach((card, i) => {
            searchCard(card, controller.signal)
                .then((result) => {
                    if (controller.signal.aborted) return;
                    setEntries(
                        (prev) =>
                            prev &&
                            prev.map((e, j) => (j === i ? { ...e, result } : e))
                    );
                })
                .catch(() => {}); // aborted
        });
        return true;
    }

    return { entries, finished, submitting, search };
}
