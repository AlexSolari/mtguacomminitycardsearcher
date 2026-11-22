// When traders' lists are read on schedule: at night in Ukraine, when the site is quietest, so the sources' and
// Scryfall's traffic doesn't compete with searches. Each list has its own time in the window (its slot), which
// spreads them over the night rather than starting them all at once. Approvals and moderators' refreshes don't
// wait for the night (see ListRefresher).

import { KYIV_TZ, kyivHour } from '@/server/lists/kyiv-time';

export const NIGHT = {
    tz: KYIV_TZ,
    from: 2, // 02:00…
    to: 7 // …06:59, local time; daylight saving is the time zone's business
};

const NIGHT_MINUTES = (NIGHT.to - NIGHT.from) * 60;

// The 5-minute check, during the night only (Bun.cron, in NIGHT.tz).
export const NIGHT_TICK = `*/5 ${NIGHT.from}-${NIGHT.to - 1} * * *`;

// A list's minute into the night. Stepping by 97 (coprime to the window's 300 minutes) puts lists approved one
// after another far apart, and gives the first 300 lists 300 different minutes.
export const slotMinute = (listId: number) => (listId * 97) % NIGHT_MINUTES;

// The first time the list's slot comes round after `after`.
export function nextSlot(listId: number, after: number): number {
    const m = slotMinute(listId);
    const hour = NIGHT.from + Math.floor(m / 60);
    return Bun.cron
        .parse(`${m % 60} ${hour} * * *`, after, { tz: NIGHT.tz })!
        .getTime();
}

export function isNight(at: number): boolean {
    const hour = kyivHour(at);
    return hour >= NIGHT.from && hour < NIGHT.to;
}
