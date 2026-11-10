import { describe, expect, test } from 'bun:test';
import { sentryOtlpTraces } from '@/server/sentry-otlp';

describe('sentryOtlpTraces', () => {
    test("Sentry's cloud: the project's OTLP traces endpoint, authenticated by the DSN's key", () => {
        expect(
            sentryOtlpTraces('https://abc123@o42.ingest.de.sentry.io/456')
        ).toEqual({
            url: 'https://o42.ingest.de.sentry.io/api/456/integration/otlp/v1/traces',
            headers: { 'x-sentry-auth': 'sentry sentry_key=abc123' }
        });
    });

    test('self-hosted: keeps the path prefix and port', () => {
        expect(
            sentryOtlpTraces('http://key@sentry.local:9000/sentry/7/').url
        ).toBe(
            'http://sentry.local:9000/sentry/api/7/integration/otlp/v1/traces'
        );
    });
});
