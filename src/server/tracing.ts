import {
    context,
    propagation,
    SpanKind,
    SpanStatusCode,
    trace,
    type Attributes,
    type Context,
    type Span
} from '@opentelemetry/api';

// A no-op until instrumentation.ts registers an SDK (production with OTEL_EXPORTER_OTLP_ENDPOINT set).
export const tracer = trace.getTracer('searcher');

// The context carried by the request's W3C `traceparent` header, which Railway's edge adds to a traced request.
// A span started in it joins the edge's trace instead of starting its own. Bun.serve has no HTTP hooks for the SDK
// to read the header, so server spans take it from here. No header gives the active context, i.e. a new trace.
export function requestContext(req: Request): Context {
    const carrier: Record<string, string> = {};
    req.headers.forEach((value, key) => (carrier[key] = value));
    return propagation.extract(context.active(), carrier);
}

export type SpanOutcome = {
    status?: number; // the HTTP status, recorded; 5xx marks the span as an error
    error?: unknown; // marks the span as an error, unless `signal` has aborted
    signal?: AbortSignal; // the caller's: once it aborts, a failure is the caller giving up, not ours
};

// Records how the span's work ended, then ends it. A caller giving up (closed tab, a new search) is routine, so
// it's an `aborted` event rather than an error; otherwise every abandoned search would count towards the error rate.
export function endSpan(
    span: Span,
    { status, error, signal }: SpanOutcome = {}
): void {
    if (status !== undefined) {
        span.setAttribute('http.response.status_code', status);
        if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    }
    if (signal?.aborted) span.addEvent('aborted');
    else if (error !== undefined) {
        span.recordException(
            error instanceof Error ? error : new Error(String(error))
        );
        span.setStatus({ code: SpanStatusCode.ERROR });
    }
    span.end();
}

// Runs `fn` inside a span that ends when it settles; a throw is recorded (see endSpan) and rethrown.
export function withSpan<T>(
    name: string,
    kind: SpanKind,
    attributes: Attributes,
    fn: (span: Span) => Promise<T>,
    {
        statusOf,
        signal
    }: {
        statusOf?: (result: T) => number | undefined;
        signal?: AbortSignal;
    } = {}
): Promise<T> {
    return tracer.startActiveSpan(name, { kind, attributes }, async (span) => {
        try {
            const result = await fn(span);
            endSpan(span, { status: statusOf?.(result) });
            return result;
        } catch (error) {
            endSpan(span, { error, signal });
            throw error;
        }
    });
}
