import {
    SpanKind,
    SpanStatusCode,
    trace,
    type Attributes
} from '@opentelemetry/api';

const tracer = trace.getTracer('searcher');

// Runs `fn` inside a span that ends when it settles; a throw marks the span as an error and is rethrown.
export async function withSpan<T>(
    name: string,
    kind: SpanKind,
    attributes: Attributes,
    fn: () => Promise<T>,
    statusOf?: (result: T) => number | undefined
): Promise<T> {
    return tracer.startActiveSpan(name, { kind, attributes }, async (span) => {
        try {
            const result = await fn();
            const status = statusOf?.(result);
            if (status !== undefined) {
                span.setAttribute('http.response.status_code', status);
                if (status >= 500)
                    span.setStatus({ code: SpanStatusCode.ERROR });
            }
            return result;
        } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
        } finally {
            span.end();
        }
    });
}
