import { expect, test } from 'bun:test';
import { CARDS, FILES, plural } from '@/i18n';

test.each([
    [1, '1 карта'],
    [2, '2 карти'],
    [5, '5 карт'],
    [11, '11 карт'],
    [21, '21 карта'],
    [22, '22 карти'],
    [25, '25 карт']
])('plural(%p, CARDS)', (n, expected) => {
    expect(plural(n, CARDS)).toBe(expected);
});

test('FILES is genitive: "з 1 файлу", "з 2 файлів"', () => {
    expect(plural(1, FILES)).toBe('1 файлу');
    expect(plural(2, FILES)).toBe('2 файлів');
});
