import { expect, test } from 'bun:test';
import { CARDS, FILES, plural, SHOPS, tooManySearches } from '@/shared/i18n';

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

test.each([
    ['20', 'забагато пошуків, спробуйте ще раз за 20 с'],
    ['89.5', 'забагато пошуків, спробуйте ще раз за 90 с'],
    ['90', 'забагато пошуків, спробуйте ще раз за 2 хв'],
    ['600', 'забагато пошуків, спробуйте ще раз за 10 хв'],
    [null, 'забагато пошуків, спробуйте трохи пізніше'],
    ['soon', 'забагато пошуків, спробуйте трохи пізніше']
])('tooManySearches(%p)', (retryAfter, expected) => {
    expect(tooManySearches(retryAfter)).toBe(expected);
});

test('FILES is genitive: "з 1 файлу", "з 2 файлів"', () => {
    expect(plural(1, FILES)).toBe('1 файлу');
    expect(plural(2, FILES)).toBe('2 файлів');
});

test('SHOPS: "1 магазин", "3 магазини", "5 магазинів"', () => {
    expect(plural(1, SHOPS)).toBe('1 магазин');
    expect(plural(3, SHOPS)).toBe('3 магазини');
    expect(plural(5, SHOPS)).toBe('5 магазинів');
});
