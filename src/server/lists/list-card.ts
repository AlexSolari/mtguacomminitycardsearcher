// What a trader's list holds, as the list parsers read it from the source (see lists/parsers/).

import { toPrice } from '@/server/shops/parse-helpers';

// Scryfall's finishes, which its prices follow (usd, usd_foil, usd_etched).
export type Finish = 'nonfoil' | 'foil' | 'etched';

// One printing in a list, as precisely as the source names it, and how many copies.
export type ListCard = {
    name: string; // as the list spells it; resolved to the card's own name when the list is stored
    quantity: number;
    finish: Finish;
    set?: string; // Scryfall's set code, lower-case
    collectorNumber?: string;
    variant?: string; // MTGGoldfish's free-text treatment: "retro", "borderless", "promo pack"…
    promo?: string; // MTGGoldfish's promo group ("PRE", "FNM", "MSC"…), which isn't a set: see list-prices.ts
    scryfallId?: string;
    image?: string;
    usd?: number; // this printing and finish's price in USD, when the list carries one (ManaBox)
};

// A price in USD as a list source gives it, to the cent (ManaBox sends floats: 9.5600004196167); undefined when
// there's none, as for `ListCard.usd`.
export const toUsd = (value: unknown): number | undefined => {
    const price = toPrice(value);
    return price === null
        ? undefined
        : Math.round(price * 100) / 100 || undefined;
};

export type ParsedList = {
    title?: string; // the list's own name, when the source has one
    editedAt?: number; // ms since the epoch: when the owner last changed it, when the source says
    cards: ListCard[];
};

// Adds up rows for the same printing, which lists repeat across sections (a card in the main deck and the
// sideboard), keeping the first row's order.
export function mergeRows(cards: ListCard[]): ListCard[] {
    const rows = new Map<string, ListCard>();
    for (const card of cards) {
        const key = [
            card.name.toLowerCase(),
            card.set,
            card.collectorNumber,
            card.variant?.toLowerCase(),
            card.promo,
            card.finish
        ].join('\n');
        const seen = rows.get(key);
        if (seen) seen.quantity += card.quantity;
        else rows.set(key, { ...card });
    }
    return [...rows.values()];
}
