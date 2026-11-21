import { expect, test } from 'bun:test';
import { kyivHour } from '@/server/kyiv-time';

test("kyivHour follows Kyiv's clock through daylight saving", () => {
    // winter, UTC+2
    expect(kyivHour(Date.UTC(2026, 0, 15, 0, 30))).toBe(2);
    expect(kyivHour(Date.UTC(2026, 0, 15, 21, 59))).toBe(23);
    expect(kyivHour(Date.UTC(2026, 0, 15, 22, 0))).toBe(0);
    // summer, UTC+3
    expect(kyivHour(Date.UTC(2026, 6, 15, 0, 30))).toBe(3);
    expect(kyivHour(Date.UTC(2026, 6, 15, 20, 59))).toBe(23);
});
