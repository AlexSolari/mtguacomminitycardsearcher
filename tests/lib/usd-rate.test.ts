import { expect, test } from 'bun:test';
import { MAX_RATE, MIN_RATE, parseRate } from '@/lib/usd-rate';
import { MAX_USD_RATE, MIN_USD_RATE } from '@/server/lists/lists-route';

test('parseRate reads a rate with a comma or a point, to the kopiyka', () => {
    expect(parseRate('42')).toBe(42);
    expect(parseRate(' 42,5 ')).toBe(42.5);
    expect(parseRate('41.237')).toBe(41.24);
    expect(parseRate('1')).toBe(1);
    expect(parseRate('1000')).toBe(1000);
});

test('parseRate: empty clears the rate; anything else is no rate', () => {
    expect(parseRate('')).toBeNull();
    expect(parseRate('  ')).toBeNull();
    for (const bad of [
        '0',
        '0,5',
        '1001',
        'abc',
        '42,5,1',
        '-42',
        '4e1',
        '42 ₴'
    ])
        expect(parseRate(bad)).toBeUndefined();
});

test("the browser's bounds are the server's", () => {
    expect([MIN_RATE, MAX_RATE]).toEqual([MIN_USD_RATE, MAX_USD_RATE]);
});
