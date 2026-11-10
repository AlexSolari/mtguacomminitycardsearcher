import {
    defaultResource,
    resourceFromAttributes
} from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
    BatchSpanProcessor,
    type SpanProcessor
} from '@opentelemetry/sdk-trace';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import * as Sentry from '@sentry/node-core/light';
import { otlpIntegration } from '@sentry/node-core/light/otlp';
import { sentryOtlpTraces } from './server/sentry-otlp';

// Loaded with `bun --preload` (see the start script). Each part starts only when its environment variable is set,
// so dev and tests are unaffected: with neither, no SDK starts and the spans created in the code are no-ops.
// No auto-instrumentations: they patch node:http and undici, which Bun's server and fetch don't use.

// The code's spans go to every backend that's configured, each through its own batch processor:
// - Railway, when tracing is enabled for the service (it sets OTEL_EXPORTER_OTLP_*). OTLP over http/protobuf,
//   which is what Railway's receiver expects (OTEL_EXPORTER_OTLP_PROTOCOL).
// - Sentry, when SENTRY_DSN is set, at the project's OTLP endpoint. Every span is kept: traffic is low, and the
//   offer-click spans are counts that sampling would skew. The exporter also sends any OTEL_EXPORTER_OTLP_HEADERS,
//   so a credential for Railway's receiver must not go there.
const spanProcessors: SpanProcessor[] = [];
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
    spanProcessors.push(
        new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })
    );
if (process.env.SENTRY_DSN)
    spanProcessors.push(
        new BatchSpanProcessor({
            exporter: new OTLPTraceExporter(
                sentryOtlpTraces(process.env.SENTRY_DSN)
            )
        })
    );

// Shared by Sentry's errors and the spans' resource, so traces and errors filter by the same environment.
const environment =
    process.env.RAILWAY_ENVIRONMENT_NAME ??
    process.env.NODE_ENV ??
    'development';
const release = process.env.RAILWAY_GIT_COMMIT_SHA;

// OTLP has no environment or release of its own; they're resource attributes. Sentry's OTLP ingestion sets the
// span's environment from them, but not (yet) its release, which errors still carry.
const otel = spanProcessors.length
    ? new NodeSDK({
          serviceName: process.env.RAILWAY_SERVICE_NAME ?? 'searcher',
          resource: defaultResource().merge(
              resourceFromAttributes({
                  'deployment.environment.name': environment,
                  'sentry.environment': environment,
                  ...(release ? { 'service.version': release } : {})
              })
          ),
          spanProcessors
      })
    : undefined;
otel?.start();

// Sentry's light SDK, which leaves tracing to the NodeSDK above instead of registering its own provider.
// otlpIntegration only links errors to the active OTel span's trace; the spans themselves go out through the
// processor above. No sendDefaultPii or includeLocalVariables: AGENTS.md rules out sending client IPs anywhere, and
// the search route's locals hold them.
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment,
        release,
        integrations: [otlpIntegration({ setupOtlpTracesExporter: false })]
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
