import type { CardEntry } from '@/decklist';

// A search lives in the page's query string so it can be shared: one `q` per card, in list order, with the
// count in front when more than one copy is wanted.
//
//   ?q=Fatal+Push&q=2+Consider&q=Opt
//
// Hand-typed links often skip the repeated `q=` (`?q=Fatal Push&Consider&Opt`), so a parameter with no value
// counts as a card too.

export function searchQuery(cards: CardEntry[]): string {
    const params = new URLSearchParams();
    for (const { name, count } of cards)
        params.append('q', count > 1 ? `${count} ${name}` : name);
    return `?${params}`;
}

// The card list text a query string describes, one line per card, ready for the textarea ('' when it has none).
export function cardListFromQuery(search: string): string {
    const lines: string[] = [];
    for (const [key, value] of new URLSearchParams(search)) {
        const line = key === 'q' ? value : value === '' ? key : '';
        if (line.trim()) lines.push(line.trim());
    }
    return lines.join('\n');
}
