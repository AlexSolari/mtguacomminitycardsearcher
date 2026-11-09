import { beforeEach } from 'bun:test';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
    InMemorySpanExporter,
    SimpleSpanProcessor,
    TracerProvider,
    type ReadableSpan
} from '@opentelemetry/sdk-trace';

// The API's provider and context manager are process-wide and can be set only once, so the first call registers
// them for every test file that runs after it. That's harmless: elsewhere spans just collect, unread.
const exporter = new InMemorySpanExporter();
let registered = false;

// Call at the top of a test file: each test starts with no spans, and the returned function lists the ones ended
// since, in the order they ended. The context manager is the one NodeSDK uses, so parents link as in production.
export function captureSpans(): () => ReadableSpan[] {
    if (!registered) {
        registered = true;
        context.setGlobalContextManager(
            new AsyncLocalStorageContextManager().enable()
        );
        trace.setGlobalTracerProvider(
            new TracerProvider({
                spanProcessors: [new SimpleSpanProcessor({ exporter })]
            })
        );
    }
    beforeEach(() => exporter.reset());
    return () => exporter.getFinishedSpans();
}

// The span's parent, or undefined for a root span.
export const parentOf = (span: ReadableSpan) => span.parentSpanContext?.spanId;
export const idOf = (span: ReadableSpan) => span.spanContext().spanId;
