import { expect, test } from 'bun:test';
import {
    isNight,
    NIGHT_TICK,
    nextSlot,
    slotMinute
} from '@/server/lists/night-schedule';

const utc = (month: number, day: number, hour: number, minute = 0) =>
    Date.UTC(2026, month - 1, day, hour, minute);

test('the night is 02:00–06:59 in Kyiv, summer and winter', () => {
    // winter, UTC+2
    expect(isNight(utc(11, 17, 0, 0))).toBe(true); // 02:00
    expect(isNight(utc(11, 17, 4, 59))).toBe(true); // 06:59
    expect(isNight(utc(11, 17, 5, 0))).toBe(false); // 07:00
    expect(isNight(utc(11, 16, 23, 59))).toBe(false); // 01:59
    // summer, UTC+3
    expect(isNight(utc(7, 17, 23, 0))).toBe(true); // 02:00
    expect(isNight(utc(7, 17, 4, 0))).toBe(false); // 07:00
    expect(NIGHT_TICK).toBe('*/5 2-6 * * *');
});

test("each list has its own minute in the night's 300, consecutive lists far apart", () => {
    expect([1, 2, 3].map(slotMinute)).toEqual([97, 194, 291]);
    const slots = new Set(Array.from({ length: 300 }, (_, i) => slotMinute(i)));
    expect(slots.size).toBe(300);
    expect(Math.max(...slots)).toBe(299);
});

test('nextSlot: the next time the slot comes round, in Kyiv time', () => {
    // list 1: 97 minutes into the night, 03:37
    expect(nextSlot(1, utc(11, 17, 12))).toBe(utc(11, 18, 1, 37)); // winter
    expect(nextSlot(1, utc(7, 17, 11))).toBe(utc(7, 18, 0, 37)); // summer
    // strictly after: from the slot itself, the next night's
    expect(nextSlot(1, utc(11, 18, 1, 36))).toBe(utc(11, 18, 1, 37));
    expect(nextSlot(1, utc(11, 18, 1, 37))).toBe(utc(11, 19, 1, 37));
    // the night's edges: list 300 at 02:00, list 3 at 06:51
    expect(nextSlot(300, utc(11, 17, 12))).toBe(utc(11, 18, 0, 0));
    expect(nextSlot(3, utc(11, 17, 12))).toBe(utc(11, 18, 4, 51));
});
