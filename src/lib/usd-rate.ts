// Sellers' exchange rates (UAH per USD), as typed on /lists.

// The server's bounds (MIN_USD_RATE, MAX_USD_RATE in server/lists-route.ts), checked here too so a typo is caught
// before it's sent.
export const MIN_RATE = 1;
export const MAX_RATE = 1000;

// "42,5" or "42.5" → 42.5, to the kopiyka; empty → null (no rate); undefined when it isn't a rate.
export function parseRate(text: string): number | null | undefined {
    const t = text.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return /^\d+(\.\d+)?$/.test(t) && n >= MIN_RATE && n <= MAX_RATE
        ? Math.round(n * 100) / 100
        : undefined;
}
