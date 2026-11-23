// How prices, dates and countdowns read in the UI. Browser-only, pure.

export const formatPrice = (price: number) =>
    `${price.toLocaleString('uk-UA')} ₴`;

export const formatUsd = (usd: number) =>
    `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DATE = new Intl.DateTimeFormat('uk', { dateStyle: 'medium' });
export const formatDate = (ms: number) => DATE.format(ms);

// Day and month only, for how fresh a trader's list is ("17 лист."): it's read every night.
const SHORT_DATE = new Intl.DateTimeFormat('uk', {
    day: 'numeric',
    month: 'short'
});
export const formatShortDate = (ms: number) => SHORT_DATE.format(ms);

// An auction's countdown at `now`, to the minute.
export function timeLeft(iso: string, now: number) {
    const ms = new Date(iso).getTime() - now;
    if (!(ms > 0)) return 'завершено';
    const m = Math.floor(ms / 60_000);
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    return d > 0
        ? `ще ${d} д ${h} год`
        : h > 0
          ? `ще ${h} год ${m % 60} хв`
          : `ще ${m} хв`;
}
