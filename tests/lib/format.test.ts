import { describe, expect, test } from 'bun:test';
import {
    formatDate,
    formatPrice,
    formatShortDate,
    formatUsd,
    timeLeft
} from '@/lib/format';

test('formatPrice groups thousands, with the hryvnia sign', () => {
    expect(formatPrice(80)).toBe('80 ₴');
    // uk-UA groups with a (narrow) no-break space
    expect(formatPrice(1234)).toMatch(/^1\s234 ₴$/u);
});

test('formatUsd always shows cents', () => {
    expect(formatUsd(2.5)).toBe('$2.50');
    expect(formatUsd(1234)).toBe('$1,234.00');
    expect(formatUsd(0.129)).toBe('$0.13');
});

test('formatDate has the year, formatShortDate only day and month', () => {
    const at = Date.UTC(2026, 10, 17, 12);
    expect(formatDate(at)).toContain('2026');
    expect(formatDate(at)).toContain('17');
    expect(formatShortDate(at)).not.toContain('2026');
    expect(formatShortDate(at)).toContain('17');
});

describe('timeLeft', () => {
    const now = Date.UTC(2026, 0, 1);
    const at = (ms: number) => new Date(now + ms).toISOString();
    const MIN = 60_000;

    test('minutes, then hours and minutes, then days and hours', () => {
        expect(timeLeft(at(5 * MIN + 30_000), now)).toBe('ще 5 хв');
        expect(timeLeft(at(125 * MIN), now)).toBe('ще 2 год 5 хв');
        expect(timeLeft(at((2 * 1440 + 3 * 60 + 10) * MIN), now)).toBe(
            'ще 2 д 3 год'
        );
    });

    test('an ended or unreadable end is over', () => {
        expect(timeLeft(at(0), now)).toBe('завершено');
        expect(timeLeft(at(-MIN), now)).toBe('завершено');
        expect(timeLeft('not a date', now)).toBe('завершено');
    });
});
