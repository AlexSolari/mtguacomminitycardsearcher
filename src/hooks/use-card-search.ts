import { useRef, useState } from 'react';
import type { CardEntry } from '@/decklist';
import type { SearchResult } from '@/shops';

// One entry per searched card, in list order. Each card is fetched by its own request, so sections fill in
// as soon as their card is done instead of waiting for the slowest one.
export type SearchEntry = {
    card: string;
    count: number; // copies wanted, from the list's quantity
    result: SearchResult | null;
};

// Cards in flight at once. The server's per-shop request queues are shared by every user and capped
// (see ShopClient), so one big deck mustn't fill them. The shops' rate limit caps throughput anyway, so a
// handful in flight finishes a deck about as fast as all of them at once.
const CONCURRENT_CARDS = 6;

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

    // Returns whether a search was started.
    function search(cards: CardEntry[]) {
        if (cards.length === 0 || submitting) return false;

        searchRef.current?.abort(); // drop any responses still in flight from a previous search
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
                const result = await searchCard(
                    cards[i]!.name,
                    controller.signal
                );
                if (controller.signal.aborted) return;
                setEntries(
                    (prev) =>
                        prev &&
                        prev.map((e, j) => (j === i ? { ...e, result } : e))
                );
            }
        };
        for (let w = 0; w < CONCURRENT_CARDS; w++) work().catch(() => {}); // aborted
        return true;
    }

    return { entries, submitting, search };
}
