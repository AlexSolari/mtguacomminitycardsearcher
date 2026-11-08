import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { warnFallback, warnIfEmpty } from '@/server/card-searcher';
import { HttpError } from '@/server/shop-client';

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
    warn = spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('warnIfEmpty', () => {
    test('logs an empty parse and passes results through', () => {
        expect(
            warnIfEmpty('carton', 'https://carton.cards/search', [])
        ).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe('warnFallback', () => {
    test('logs a failure', () => {
        warnFallback('gin', 'https://mtgin.kyiv.ua/x', new HttpError(429));
        expect(warn).toHaveBeenCalledTimes(1);
    });

    test('an expected 404 is quiet', () => {
        warnFallback('manavault', 'u', new HttpError(404), undefined, {
            expect404: true
        });
        expect(warn).not.toHaveBeenCalled();
    });

    test('a 404 is logged when not expected', () => {
        warnFallback('manavault', 'u', new HttpError(404));
        expect(warn).toHaveBeenCalledTimes(1);
    });

    test('rethrows when the search was aborted, so it is not a fallback', () => {
        const err = new DOMException('aborted', 'AbortError');
        expect(() =>
            warnFallback('gin', 'u', err, AbortSignal.abort())
        ).toThrow(err);
        expect(warn).not.toHaveBeenCalled();
    });
});
