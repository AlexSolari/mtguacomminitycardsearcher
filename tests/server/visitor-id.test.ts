import { describe, expect, test } from 'bun:test';
import { VisitorIds } from '@/server/visitor-id';

// A clock the test moves by hand.
function clock(iso: string) {
    let now = new Date(iso);
    return {
        now: () => now,
        set: (next: string) => (now = new Date(next))
    };
}

describe('VisitorIds', () => {
    test('the same IP and browser keep one id all day', () => {
        const time = clock('2026-11-09T00:00:01Z');
        const visitors = new VisitorIds(time.now);
        const morning = visitors.id('1.2.3.4', 'Firefox');
        time.set('2026-11-09T23:59:59Z');
        expect(visitors.id('1.2.3.4', 'Firefox')).toBe(morning);
        expect(morning).toMatch(/^[0-9a-f]{16}$/);
    });

    test('a different IP or browser is a different visitor', () => {
        const visitors = new VisitorIds(clock('2026-11-09T12:00:00Z').now);
        const ids = new Set([
            visitors.id('1.2.3.4', 'Firefox'),
            visitors.id('1.2.3.5', 'Firefox'),
            visitors.id('1.2.3.4', 'Chrome'),
            visitors.id('1.2.3.4', null)
        ]);
        expect(ids.size).toBe(4);
    });

    test('a new day (UTC) gets a new salt, so ids from different days do not match', () => {
        const time = clock('2026-11-09T23:59:59Z');
        const salts: string[] = [];
        const visitors = new VisitorIds(time.now, () => {
            salts.push(`salt ${salts.length}`);
            return salts.at(-1)!;
        });
        const today = visitors.id('1.2.3.4', 'Firefox');
        time.set('2026-11-10T00:00:00Z');
        expect(visitors.id('1.2.3.4', 'Firefox')).not.toBe(today);
        expect(salts).toEqual(['salt 0', 'salt 1']);
    });

    test('each instance has its own random salt, so an id cannot be recomputed from the IP', () => {
        const now = clock('2026-11-09T12:00:00Z').now;
        expect(new VisitorIds(now).id('1.2.3.4', 'Firefox')).not.toBe(
            new VisitorIds(now).id('1.2.3.4', 'Firefox')
        );
    });
});
