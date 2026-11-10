// The server's one place for logging. Every entry is a record: a fixed message saying what happened, and the
// details as fields, so logs can be filtered by field (shop, url, card) instead of grepped as text.
//
// Production writes one JSON object per line, all to stdout, in the shape Railway parses: `message` is the text it
// shows, `level` the severity, and every other key a filterable attribute (`@shop:carton`):
//   {"time":"2026-11-06T12:00:00.000Z","level":"warn","message":"parser found nothing","shop":"carton","url":"https://…"}
// Everywhere else writes the same record as one readable line:
//   12:00:00.000 WARN  parser found nothing shop=carton url=https://…
// LOG_LEVEL (debug | info | warn | error, default info) and LOG_FORMAT (json | pretty) override the defaults.
//
// Error records also go to Sentry (see reportToSentry).
//
// Server-only: it writes to process.stdout / process.stderr.

import { captureException, captureMessage } from '@sentry/node-core/light';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'pretty';
// Field names must not be `time`, `level` or `message`. An Error value is logged as name, message, status and stack.
export type LogFields = Record<string, unknown>;
export type LogRecord = {
    time: string;
    level: LogLevel;
    message: string;
} & LogFields;
export type LogSink = (record: LogRecord) => void;
export type LogConfig = { level: LogLevel; sink: LogSink };

const LEVELS: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40
};

// JSON.stringify turns an Error into {}, so errors are copied into a plain object first.
// A ShopRequestError's details are kept: `status`, so 403s and 429s can be counted, and the request, the response's
// type and the start of its body, which usually say what went wrong. A `cause` is kept as its message.
export function serializeError(err: Error) {
    return {
        name: err.name,
        message: err.message,
        ...errorDetails(err),
        stack: err.stack
    };
}

function errorDetails(err: Error) {
    const { status, method, url, contentType, body, cause } = err as Partial<
        Record<
            'status' | 'method' | 'url' | 'contentType' | 'body' | 'cause',
            unknown
        >
    >;
    return {
        ...(typeof status === 'number' ? { status } : {}),
        ...(typeof method === 'string' ? { method } : {}),
        ...(typeof url === 'string' ? { url } : {}),
        ...(typeof contentType === 'string' ? { contentType } : {}),
        ...(typeof body === 'string' ? { body } : {}),
        ...(cause instanceof Error ? { cause: cause.message } : {})
    };
}

type SerializedError = ReturnType<typeof serializeError>;
const isSerializedError = (value: unknown): value is SerializedError =>
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'message' in value;

// Logging must never throw. A field that can't be serialized (a cycle, a BigInt) loses its fields, not the entry.
export function formatJson(record: LogRecord): string {
    try {
        return JSON.stringify(record);
    } catch (err) {
        const { time, level, message } = record;
        return JSON.stringify({
            time,
            level,
            message,
            logError: `fields not serializable: ${(err as Error).message}`
        });
    }
}

// Strings without spaces are printed as is; anything else as JSON, so `key=value` pairs stay unambiguous.
function prettyValue(value: unknown): string {
    // error="HTTP 400 POST https://… {\"error\":\"bad query\"}"
    if (isSerializedError(value)) {
        const { message, method, url, body } = value as SerializedError &
            Partial<Record<'method' | 'url' | 'body', string>>;
        return prettyValue(
            [message, url && `${method ?? 'GET'} ${url}`, body]
                .filter(Boolean)
                .join(' ')
        );
    }
    if (typeof value === 'string' && value !== '' && !/\s/.test(value))
        return value;
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

// 12:00:00.000 ERROR shop search failed shop=gin card="Sol Ring" error="timeout after 15s"
// For level error, the stacks of any errors follow on the next lines.
export function formatPretty(record: LogRecord): string {
    const { time, level, message, ...fields } = record;
    const parts = [time.slice(11, 23), level.toUpperCase().padEnd(5), message];
    let stacks = '';
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        parts.push(`${key}=${prettyValue(value)}`);
        if (level === 'error' && isSerializedError(value) && value.stack)
            stacks += `\n${value.stack}`;
    }
    return parts.join(' ') + stacks;
}

// JSON goes to stdout whatever its level: Railway marks everything on stderr as an error, and the record's
// `level` already says how severe it is. The pretty format sends warnings and errors to stderr, the rest to stdout.
export function writeSink(format: LogFormat): LogSink {
    return (record) => {
        if (format === 'json') {
            process.stdout.write(`${formatJson(record)}\n`);
            return;
        }
        const line = formatPretty(record);
        const out =
            LEVELS[record.level] >= LEVELS.warn
                ? process.stderr
                : process.stdout;
        out.write(`${line}\n`);
    };
}

export function configFromEnv(
    env: Record<string, string | undefined> = process.env
): LogConfig {
    const level =
        env.LOG_LEVEL && Object.hasOwn(LEVELS, env.LOG_LEVEL)
            ? (env.LOG_LEVEL as LogLevel)
            : 'info';
    const format: LogFormat =
        env.LOG_FORMAT === 'json' || env.LOG_FORMAT === 'pretty'
            ? env.LOG_FORMAT
            : env.NODE_ENV === 'production'
              ? 'json'
              : 'pretty';
    return { level, sink: writeSink(format) };
}

let config = configFromEnv();

// Replaces parts of the config and returns the previous one, so tests can capture records and restore after.
export function configureLogger(changes: Partial<LogConfig>): LogConfig {
    const previous = config;
    config = { ...config, ...changes };
    return previous;
}

function log(level: LogLevel, message: string, fields: LogFields = {}) {
    if (LEVELS[level] < LEVELS[config.level]) return;
    const serialized = Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
            key,
            value instanceof Error ? serializeError(value) : value
        ])
    );
    config.sink({
        time: new Date().toISOString(),
        level,
        message,
        ...serialized
    });
    if (level === 'error') reportToSentry(message, fields);
}

// The server catches its failures and logs them rather than letting them reach the runtime, so Sentry's global
// handlers never see them; error records are reported from here instead. An Error field becomes the event, with
// its stack; the message and the other fields go along as context. A no-op until instrumentation.ts initializes
// Sentry (SENTRY_DSN set), so tests and dev send nothing.
function reportToSentry(message: string, fields: LogFields) {
    const error = Object.values(fields).find((value) => value instanceof Error);
    const context = {
        message,
        ...Object.fromEntries(
            Object.entries(fields).filter(([, value]) => value !== error)
        )
    };
    // Sentry records only an error's name, message and stack; its other fields go along as their own context
    if (error) {
        const details = errorDetails(error as Error);
        captureException(error, {
            contexts: {
                log: context,
                ...(Object.keys(details).length ? { error: details } : {})
            }
        });
    } else
        captureMessage(message, { level: 'error', contexts: { log: context } });
}

// Keep `message` a fixed string ("shop search failed") and put what varies in `fields` ({ shop, card, error }),
// so every occurrence of an event can be found by its message.
export const logger = {
    debug: (message: string, fields?: LogFields) =>
        log('debug', message, fields),
    info: (message: string, fields?: LogFields) => log('info', message, fields),
    warn: (message: string, fields?: LogFields) => log('warn', message, fields),
    error: (message: string, fields?: LogFields) =>
        log('error', message, fields)
};
