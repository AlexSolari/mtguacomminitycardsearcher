// Where Sentry receives OTLP traces for the project a DSN names, and the header that authenticates them.
// https://<key>@o123.ingest.de.sentry.io/456 → https://o123.ingest.de.sentry.io/api/456/integration/otlp/v1/traces
// with `x-sentry-auth: sentry sentry_key=<key>`. Self-hosted DSNs can carry a path prefix before the project id.
export function sentryOtlpTraces(dsn: string): {
    url: string;
    headers: Record<string, string>;
} {
    const { origin, pathname, username } = new URL(dsn);
    const path = pathname.replace(/\/+$/, '');
    const slash = path.lastIndexOf('/');
    const prefix = path.slice(0, slash);
    const project = path.slice(slash + 1);
    return {
        url: `${origin}${prefix}/api/${project}/integration/otlp/v1/traces`,
        headers: { 'x-sentry-auth': `sentry sentry_key=${username}` }
    };
}
