import { describe, expect, test } from 'bun:test';
import {
    abs,
    decodeEntities,
    extractJsonArray,
    languageCode,
    parsePrice,
    readNextFlight
} from '@/server/parsers/helpers';

describe('parsePrice', () => {
    test.each([
        ['1 234 ₴', 1234],
        ['від 42 грн', 42],
        ['124', 124]
    ])('%p → %p', (input, expected) => {
        expect(parsePrice(input)).toBe(expected);
    });

    // "—" must not become 0 ₴, which would win best price
    test.each(['—', 'Немає', '', undefined])('%p → null', (input) => {
        expect(parsePrice(input)).toBeNull();
    });
});

describe('decodeEntities', () => {
    test('named and numeric entities', () => {
        expect(
            decodeEntities('Fire &amp; Ice &quot;x&quot; &#39;y&#39; &#x2014;')
        ).toBe('Fire & Ice "x" \'y\' —');
    });
    test('decodes once: "&amp;lt;" stays "&lt;"', () => {
        expect(decodeEntities('&amp;lt;')).toBe('&lt;');
    });
    test('out-of-range code points become �', () => {
        expect(decodeEntities('&#99999999;')).toBe('�');
    });
});

describe('abs', () => {
    test('resolves against the base, decoding entities', () => {
        expect(abs('https://shop.ua', '/cards?a=1&amp;b=2')).toBe(
            'https://shop.ua/cards?a=1&b=2'
        );
    });
    test('keeps absolute URLs', () => {
        expect(abs('https://shop.ua', 'https://cdn.ua/x.jpg')).toBe(
            'https://cdn.ua/x.jpg'
        );
    });
    test('no path → null', () => {
        expect(abs('https://shop.ua', undefined)).toBeNull();
    });
});

describe('languageCode', () => {
    test.each([
        ['English', 'EN'],
        ['en', 'EN'],
        [' Simplified Chinese ', 'ZHS'],
        ['ukrainian', 'UK']
    ])('%p → %p', (input, expected) => {
        expect(languageCode(input)).toBe(expected);
    });
    test.each(['Klingon', '', null, undefined])('%p → undefined', (input) => {
        expect(languageCode(input)).toBeUndefined();
    });
});

describe('extractJsonArray', () => {
    test('bracket matching skips brackets and escaped quotes inside strings', () => {
        const blob = `{"x":1,"items":[{"name":"a ] \\" [ b","n":[1,2]},{"name":"c"}],"after":[9]}`;
        expect(extractJsonArray(blob, 'items')).toEqual([
            { name: 'a ] " [ b', n: [1, 2] },
            { name: 'c' }
        ]);
    });
    test('missing key → null', () => {
        expect(extractJsonArray('{"other":[]}', 'items')).toBeNull();
    });
});

test('readNextFlight concatenates the pushed chunks', () => {
    const html =
        '<script>self.__next_f.push([1,"{\\"items\\":["])</script>' +
        '<script>self.__next_f.push([1,"1,2]}"])</script>';
    expect(readNextFlight(html)).toBe('{"items":[1,2]}');
});
