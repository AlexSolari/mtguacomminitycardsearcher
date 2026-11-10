import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import * as Sentry from '@sentry/node-core/light';
import { otlpIntegration } from '@sentry/node-core/light/otlp';

// Loaded with `bun --preload` (see the start script). Each part starts only when its environment variable is set,
// so dev and tests are unaffected.

// Exports OTLP over http/protobuf, which is what Railway's receiver expects (OTEL_EXPORTER_OTLP_PROTOCOL).
// Railway sets OTEL_EXPORTER_OTLP_* when tracing is enabled for the service; without it the spans created in the
// code are no-ops. No auto-instrumentations: they patch node:http and undici, which Bun's server and fetch don't use.
const otel = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? new NodeSDK({
          serviceName: process.env.RAILWAY_SERVICE_NAME ?? 'searcher',
          traceExporter: new OTLPTraceExporter()
      })
    : undefined;
otel?.start();

// Sentry's light SDK, which leaves tracing to the NodeSDK above instead of registering its own provider. Errors
// carry the active OTel span's trace id, and otlpIntegration adds a processor to the NodeSDK's provider so the same
// spans also reach Sentry. Without the NodeSDK it would create a provider of its own, with no context manager, so
// spans would lose their parents; it's off then. No sendDefaultPii or includeLocalVariables: AGENTS.md rules out
// sending client IPs anywhere, and the search route's locals hold them.
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment:
            process.env.RAILWAY_ENVIRONMENT_NAME ??
            process.env.NODE_ENV ??
            'development',
        release: process.env.RAILWAY_GIT_COMMIT_SHA,
        integrations: [
            otlpIntegration({ setupOtlpTracesExporter: otel !== undefined })
        ]
    });
}

// Spans and events go out in batches every few seconds, so a redeploy's SIGTERM would drop the last ones. Flush them
// first. Handling the signal replaces the default exit, so the handler has to exit itself.
if (otel || Sentry.isInitialized()) {
    process.once('SIGTERM', () => {
        Promise.allSettled([otel?.shutdown(), Sentry.close(2000)]).finally(() =>
            process.exit(0)
        );
    });
}
