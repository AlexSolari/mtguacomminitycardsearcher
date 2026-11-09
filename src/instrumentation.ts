import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';

// Exports OTLP over http/protobuf, which is what Railway's receiver expects (OTEL_EXPORTER_OTLP_PROTOCOL).
// Loaded with `bun --preload` (see the start script). Railway sets OTEL_EXPORTER_OTLP_* when tracing is enabled
// for the service; without it nothing starts and the spans created in the code are no-ops, so dev and tests are
// unaffected. No auto-instrumentations: they patch node:http and undici, which Bun's server and fetch don't use.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const sdk = new NodeSDK({
        serviceName: process.env.RAILWAY_SERVICE_NAME ?? 'searcher',
        traceExporter: new OTLPTraceExporter()
    });
    sdk.start();

    // Spans go out in batches every few seconds, so a redeploy's SIGTERM would drop the last batch. Flush it
    // first. Handling the signal replaces the default exit, so the handler has to exit itself.
    process.once('SIGTERM', () => {
        sdk.shutdown().finally(() => process.exit(0));
    });
}
