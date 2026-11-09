import { describe, expect, test } from 'bun:test';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { endSpan, tracer, withSpan } from '@/server/tracing';
import { captureSpans, idOf, parentOf } from './capture-spans';

const spans = captureSpans();

describe('withSpan', () => {
    test('returns the result and ends the span with its attributes and status code', async () => {
        const result = await withSpan(
            'GET shop',
            SpanKind.CLIENT,
            { 'server.address': 'shop' },
            async () => ({ status: 200 }),
            { statusOf: (res) => res.status }
        );
        expect(result).toEqual({ status: 200 });
        expect(spans()).toMatchObject([
            {
                name: 'GET shop',
                kind: SpanKind.CLIENT,
                attributes: {
                    'server.address': 'shop',
                    'http.response.status_code': 200
                },
                status: { code: SpanStatusCode.UNSET }
            }
        ]);
    });

    test('a 5xx marks the span as an error, a 4xx does not', async () => {
        for (const status of [503, 404])
            await withSpan(
                'GET shop',
                SpanKind.CLIENT,
                {},
                async () => status,
                {
                    statusOf: (s) => s
                }
            );
        expect(spans().map((s) => s.status.code)).toEqual([
            SpanStatusCode.ERROR,
            SpanStatusCode.UNSET
        ]);
    });

    test('without statusOf, no status code is recorded', async () => {
        await withSpan('work', SpanKind.INTERNAL, {}, async () => 'done');
        expect(spans()[0]!.attributes).not.toHaveProperty(
            'http.response.status_code'
        );
    });

    test('a throw is recorded as an error and rethrown', async () => {
        await expect(
            withSpan('GET shop', SpanKind.CLIENT, {}, async () => {
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');
        const [span] = spans();
        expect(span!.status.code).toBe(SpanStatusCode.ERROR);
        expect(span!.events).toMatchObject([
            { name: 'exception', attributes: { 'exception.message': 'boom' } }
        ]);
    });

    test("a throw after the caller's signal aborted is an `aborted` event, not an error", async () => {
        const signal = AbortSignal.abort();
        await expect(
            withSpan(
                'GET shop',
                SpanKind.CLIENT,
                {},
                async () => signal.throwIfAborted(),
                { signal }
            )
        ).rejects.toHaveProperty('name', 'AbortError');
        const [span] = spans();
        expect(span!.status.code).toBe(SpanStatusCode.UNSET);
        expect(span!.events.map((e) => e.name)).toEqual(['aborted']);
    });

    test('spans started inside become its children, also after an await', async () => {
        await withSpan('outer', SpanKind.SERVER, {}, async () => {
            await Bun.sleep(1);
            await withSpan('inner', SpanKind.CLIENT, {}, async () => {});
        });
        const [inner, outer] = spans();
        expect(parentOf(inner!)).toBe(idOf(outer!));
        expect(parentOf(outer!)).toBeUndefined();
    });
});

describe('endSpan', () => {
    test('a thrown non-Error is recorded with its text', () => {
        endSpan(tracer.startSpan('work'), { error: 'plain string' });
        expect(spans()[0]!.events).toMatchObject([
            {
                name: 'exception',
                attributes: { 'exception.message': 'plain string' }
            }
        ]);
    });
});
