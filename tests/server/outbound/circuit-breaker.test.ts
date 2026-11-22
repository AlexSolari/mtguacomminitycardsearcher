import { describe, expect, test } from 'bun:test';
import {
    CircuitBreaker,
    ShopUnavailableError
} from '@/server/outbound/circuit-breaker';

// A breaker that opens after 3 failures for 1000 ms, on a clock the test moves.
function breaker() {
    let now = 0;
    let opens = 0;
    const b = new CircuitBreaker(
        () => opens++,
        3,
        1000,
        () => now
    );
    const admitted = () => {
        try {
            b.admit();
            return true;
        } catch (err) {
            expect(err).toBeInstanceOf(ShopUnavailableError);
            return false;
        }
    };
    return {
        b,
        admitted,
        advance: (ms: number) => (now += ms),
        opens: () => opens
    };
}

describe('CircuitBreaker', () => {
    test('opens after 3 failures in a row, and says so once', () => {
        const { b, admitted, opens } = breaker();
        for (let i = 0; i < 3; i++) {
            expect(admitted()).toBe(true);
            b.settle('down');
        }
        expect(admitted()).toBe(false);
        expect(opens()).toBe(1);
    });

    test('an answer in between resets the count; a verdict-less request changes nothing', () => {
        const { b, admitted } = breaker();
        b.settle('down');
        b.settle('down');
        b.settle('up');
        b.settle('down');
        b.settle(null);
        b.settle('down');
        expect(admitted()).toBe(true);
        b.settle('down');
        expect(admitted()).toBe(false);
    });

    test('opening aborts `opened`, and the next opening gets a fresh signal', () => {
        const { b } = breaker();
        const first = b.opened;
        for (let i = 0; i < 3; i++) b.settle('down');
        expect(first.aborted).toBe(true);
        expect(first.reason).toBeInstanceOf(ShopUnavailableError);
        expect(b.opened.aborted).toBe(false);
    });

    test('after the pause, one probe goes through; the rest fail until it settles', () => {
        const { b, admitted, advance } = breaker();
        for (let i = 0; i < 3; i++) b.settle('down');
        advance(999);
        expect(admitted()).toBe(false);
        advance(1);
        expect(admitted()).toBe(true);
        expect(admitted()).toBe(false);
        b.settle('up');
        expect(admitted()).toBe(true);
        expect(admitted()).toBe(true);
    });

    test('a failed probe keeps it open for another pause, without saying so again', () => {
        const { b, admitted, advance, opens } = breaker();
        for (let i = 0; i < 3; i++) b.settle('down');
        advance(1000);
        expect(admitted()).toBe(true);
        b.settle('down');
        expect(admitted()).toBe(false);
        advance(1000);
        expect(admitted()).toBe(true);
        expect(opens()).toBe(1);
    });

    test('a probe whose caller gave up frees the place for the next', () => {
        const { b, admitted, advance } = breaker();
        for (let i = 0; i < 3; i++) b.settle('down');
        advance(1000);
        expect(admitted()).toBe(true);
        b.settle(null);
        expect(admitted()).toBe(true);
    });
});
