import { describe, expect, test } from 'bun:test';
import {
    abs,
    asString,
    capitalize,
    decodeEntities,
    isArtSeriesSet,
    languageCode,
    toPrice,
    withEdition
} from '@/server/parsers/helpers';

describe('toPrice', () => {
    test.each([
        [124, 124],
        ['183.00', 183],
        ['99.50', 99.5]
    ])('%p → %p', (input, expected) => {
        expect(toPrice(input)).toBe(expected);
    });

    // none of these may become 0 ₴, which would win best price
    test.each([
        0,
        '0.00',
        -5,
        null,
        undefined,
        '',
        '—',
        NaN,
        Infinity,
        true,
        {}
    ])('%p → null', (input) => {
        expect(toPrice(input)).toBeNull();
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
        expect(abs('https://shop.ua', '')).toBeNull();
    });
    // one odd link mustn't fail the whole parse
    test("a path that isn't a URL → null, not a throw", () => {
        expect(abs('https://shop.ua', 'http://[')).toBeNull();
    });
});

test('asString: a string, or undefined for anything else', () => {
    expect(asString('Sol Ring')).toBe('Sol Ring');
    expect(asString('')).toBe('');
    for (const v of [undefined, null, 42, true, {}, ['a']])
        expect(asString(v)).toBeUndefined();
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

describe('withEdition', () => {
    test('name — set #number, then the details, leaving out empty parts', () => {
        expect(
            withEdition('Sol Ring', 'Commander Masters', '1', 'Etched', false)
        ).toBe('Sol Ring — Commander Masters #1, Etched');
        expect(withEdition('Sol Ring', 'Fallout', 359)).toBe(
            'Sol Ring — Fallout #359'
        );
        expect(withEdition('Boltwave', 'Foundations', null, 'Etched')).toBe(
            'Boltwave — Foundations, Etched'
        );
        expect(withEdition('Opt', null, '12', null, 'Promo')).toBe(
            'Opt — #12, Promo'
        );
        expect(withEdition('Opt', '', undefined, undefined, 'Promo')).toBe(
            'Opt — Promo'
        );
    });

    test('with no edition at all, the name is as it is', () => {
        expect(withEdition('Opt', undefined)).toBe('Opt');
        expect(withEdition('Opt', null, '', false, null)).toBe('Opt');
    });
});

test('capitalize', () => {
    expect(capitalize('etched')).toBe('Etched');
    expect(capitalize('Showcase')).toBe('Showcase');
    expect(capitalize('')).toBe('');
});

test('isArtSeriesSet: a set named "… Art Series", as a whole phrase', () => {
    expect(isArtSeriesSet('Modern Horizons 3 Art Series')).toBe(true);
    expect(isArtSeriesSet('art series: dominaria')).toBe(true);
    expect(isArtSeriesSet('Commander Masters')).toBe(false);
    expect(isArtSeriesSet('Smart Seriesless')).toBe(false);
    expect(isArtSeriesSet(null)).toBe(false);
    expect(isArtSeriesSet(undefined)).toBe(false);
});
