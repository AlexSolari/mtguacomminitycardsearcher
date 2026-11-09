import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Loaded with `bun --preload` (see the start script). Railway sets OTEL_EXPORTER_OTLP_* when tracing is enabled
// for the service; without it nothing starts and the spans created in the code are no-ops, so dev and tests are
// unaffected. No auto-instrumentations: they patch node:http and undici, which Bun's server and fetch don't use.
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    new NodeSDK({
        serviceName: process.env.RAILWAY_SERVICE_NAME ?? 'searcher',
        traceExporter: new OTLPTraceExporter()
    }).start();
}
