import { describe, expect, test } from 'bun:test';
import { warnFallback, warnIfEmpty } from '@/server/card-searcher';
import { HttpError } from '@/server/shop-client';
import { captureLogs } from './capture-logs';

const logs = captureLogs();

describe('warnIfEmpty', () => {
    test('logs an empty parse and passes results through', () => {
        expect(
            warnIfEmpty('carton', 'https://carton.cards/search', [])
        ).toEqual([]);
        expect(logs).toMatchObject([
            {
                level: 'warn',
                message: 'parser found nothing',
                shop: 'carton',
                url: 'https://carton.cards/search'
            }
        ]);
    });
});

describe('warnFallback', () => {
    test('logs a failure', () => {
        warnFallback('gin', 'https://mtgin.kyiv.ua/x', new HttpError(429));
        expect(logs).toMatchObject([
            {
                level: 'warn',
                message: 'follow-up request failed, keeping search results',
                shop: 'gin',
                url: 'https://mtgin.kyiv.ua/x',
                error: { message: 'HTTP 429', status: 429 }
            }
        ]);
    });

    test('an expected 404 is quiet', () => {
        warnFallback('manavault', 'u', new HttpError(404), undefined, {
            expect404: true
        });
        expect(logs).toEqual([]);
    });

    test('a 404 is logged when not expected', () => {
        warnFallback('manavault', 'u', new HttpError(404));
        expect(logs).toHaveLength(1);
    });

    test('rethrows when the search was aborted, so it is not a fallback', () => {
        const err = new DOMException('aborted', 'AbortError');
        expect(() =>
            warnFallback('gin', 'u', err, AbortSignal.abort())
        ).toThrow(err);
        expect(logs).toEqual([]);
    });
});
