import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    spyOn,
    test
} from 'bun:test';
import {
    configFromEnv,
    configureLogger,
    formatJson,
    formatPretty,
    logger,
    serializeError,
    writeSink,
    type LogRecord
} from '@/server/logger';
import { HttpError, InvalidJsonError } from '@/server/shop-client';
import * as Sentry from '@sentry/node-core/light';
import type { ErrorEvent } from '@sentry/node-core/light';
import { captureLogs } from './capture-logs';

const record = (fields: Partial<LogRecord> = {}): LogRecord => ({
    time: '2026-11-06T12:00:00.000Z',
    level: 'warn',
    message: 'parser found nothing',
    ...fields
});

describe('logger', () => {
    const logs = captureLogs();

    test('records the level, message and fields', () => {
        logger.debug('d');
        logger.info('search', { cards: ['Sol Ring'], count: 1 });
        logger.warn('w');
        logger.error('e');
        expect(logs.map((r) => r.level)).toEqual([
            'debug',
            'info',
            'warn',
            'error'
        ]);
        expect(logs[1]).toEqual({
            time: expect.any(String),
            level: 'info',
            message: 'search',
            cards: ['Sol Ring'],
            count: 1
        });
        expect(new Date(logs[1]!.time).toISOString()).toBe(logs[1]!.time);
    });

    test('drops entries below the configured level', () => {
        const previous = configureLogger({ level: 'warn' });
        logger.info('quiet');
        logger.warn('loud');
        configureLogger(previous);
        expect(logs.map((r) => r.message)).toEqual(['loud']);
    });

    test('serializes Error fields', () => {
        logger.error('failed', { error: new HttpError(429) });
        expect(logs[0]!.error).toEqual({
            name: 'HttpError',
            message: 'HTTP 429',
            status: 429,
            stack: expect.any(String)
        });
    });

    test("keeps an HttpError's request and body", () => {
        logger.error('failed', {
            error: new HttpError(400, {
                method: 'POST',
                url: 'https://shop.test/api',
                body: '{"error":"bad query"}'
            })
        });
        expect(logs[0]!.error).toMatchObject({
            status: 400,
            method: 'POST',
            url: 'https://shop.test/api',
            body: '{"error":"bad query"}'
        });
    });
});

describe('serializeError', () => {
    test("keeps a request error's content type, and its cause as a message", () => {
        const err = new InvalidJsonError('expected JSON, got text/html', {
            contentType: 'text/html',
            cause: new SyntaxError('Unexpected token <')
        });
        expect(serializeError(err)).toEqual({
            name: 'InvalidJsonError',
            message: 'expected JSON, got text/html',
            contentType: 'text/html',
            cause: 'Unexpected token <',
            stack: expect.any(String)
        });
    });

    test('keeps status only when the error has a numeric one', () => {
        expect(serializeError(new TypeError('bad'))).toEqual({
            name: 'TypeError',
            message: 'bad',
            stack: expect.any(String)
        });
    });
});

describe('formatJson', () => {
    test('one JSON object', () => {
        expect(JSON.parse(formatJson(record({ shop: 'carton' })))).toEqual(
            record({ shop: 'carton' })
        );
    });

    test('unserializable fields lose the fields, not the entry', () => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        expect(JSON.parse(formatJson(record({ cycle })))).toEqual({
            ...record(),
            logError: expect.stringContaining('fields not serializable')
        });
    });
});

describe('formatPretty', () => {
    test('time, level, message, then key=value pairs', () => {
        expect(
            formatPretty(
                record({
                    shop: 'carton',
                    card: 'Sol Ring',
                    empty: '',
                    count: 3,
                    cards: ['a'],
                    skipped: undefined
                })
            )
        ).toBe(
            '12:00:00.000 WARN  parser found nothing shop=carton card="Sol Ring" empty="" count=3 cards=["a"]'
        );
    });

    test('errors show their message; stacks follow only for level error', () => {
        const error = serializeError(new Error('timeout after 15s'));
        expect(formatPretty(record({ error }))).toBe(
            '12:00:00.000 WARN  parser found nothing error="timeout after 15s"'
        );
        expect(
            formatPretty(record({ level: 'error', message: 'failed', error }))
        ).toBe(
            `12:00:00.000 ERROR failed error="timeout after 15s"\n${error.stack}`
        );
    });

    test('an HttpError shows its request and body after the message', () => {
        const error = serializeError(
            new HttpError(400, {
                method: 'POST',
                url: 'https://shop.test/api',
                body: 'bad query'
            })
        );
        expect(formatPretty(record({ error }))).toBe(
            '12:00:00.000 WARN  parser found nothing error="HTTP 400 POST https://shop.test/api bad query"'
        );
    });

    test('values JSON cannot show fall back to String', () => {
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        expect(formatPretty(record({ n: 1n, cycle }))).toBe(
            '12:00:00.000 WARN  parser found nothing n=1 cycle=[object Object]'
        );
    });
});

// writeSink and configFromEnv write to the real streams; these catch it.
const stdout = spyOn(process.stdout, 'write').mockImplementation(() => true);
const stderr = spyOn(process.stderr, 'write').mockImplementation(() => true);
afterEach(() => {
    stdout.mockClear();
    stderr.mockClear();
});
afterAll(() => {
    stdout.mockRestore();
    stderr.mockRestore();
});

describe('writeSink', () => {
    test('JSON: every level to stdout (Railway counts stderr as errors), one line each', () => {
        const sink = writeSink('json');
        sink(record({ level: 'info' }));
        sink(record({ level: 'error' }));
        expect(stdout.mock.calls).toEqual([
            [`${formatJson(record({ level: 'info' }))}\n`],
            [`${formatJson(record({ level: 'error' }))}\n`]
        ]);
        expect(stderr).not.toHaveBeenCalled();
    });

    test('pretty: info to stdout, warnings and errors to stderr', () => {
        const sink = writeSink('pretty');
        sink(record({ level: 'info' }));
        sink(record({ level: 'warn' }));
        expect(stdout).toHaveBeenCalledWith(
            `${formatPretty(record({ level: 'info' }))}\n`
        );
        expect(stderr).toHaveBeenCalledWith(
            `${formatPretty(record({ level: 'warn' }))}\n`
        );
    });
});

describe('configFromEnv', () => {
    const formatOf = (env: Record<string, string>) => {
        stdout.mockClear();
        stderr.mockClear();
        configFromEnv(env).sink(record());
        const line = String(
            (stdout.mock.calls[0] ?? stderr.mock.calls[0])?.[0]
        );
        return line.startsWith('{') ? 'json' : 'pretty';
    };

    test('JSON in production, pretty elsewhere, LOG_FORMAT overrides', () => {
        expect(formatOf({ NODE_ENV: 'production' })).toBe('json');
        expect(formatOf({})).toBe('pretty');
        expect(formatOf({ NODE_ENV: 'production', LOG_FORMAT: 'pretty' })).toBe(
            'pretty'
        );
        expect(formatOf({ LOG_FORMAT: 'json' })).toBe('json');
    });

    test('LOG_LEVEL, falling back to info for unknown values', () => {
        expect(configFromEnv({ LOG_LEVEL: 'debug' }).level).toBe('debug');
        expect(configFromEnv({ LOG_LEVEL: 'toString' }).level).toBe('info');
        expect(configFromEnv({}).level).toBe('info');
    });
});

describe('Sentry reporting', () => {
    captureLogs();
    const events: ErrorEvent[] = [];

    // Events are recorded and dropped in beforeSend, so nothing leaves the process.
    beforeAll(() => {
        Sentry.init({
            dsn: 'https://key@sentry.invalid/1',
            defaultIntegrations: false,
            beforeSend: (event) => {
                events.push(event);
                return null;
            }
        });
    });
    afterEach(() => {
        events.length = 0;
    });
    afterAll(() => Sentry.close());

    test('an error record with an Error field reports the exception, with the rest as context', async () => {
        logger.error('shop search failed', {
            shop: 'gin',
            card: 'Sol Ring',
            error: new Error('timeout after 15s')
        });
        await Sentry.flush();
        expect(events).toHaveLength(1);
        expect(events[0]!.exception?.values?.[0]?.value).toBe(
            'timeout after 15s'
        );
        expect(events[0]!.contexts?.log).toEqual({
            message: 'shop search failed',
            shop: 'gin',
            card: 'Sol Ring'
        });
    });

    test("an HttpError's details go along as their own context", async () => {
        logger.error('shop search failed', {
            error: new HttpError(404, { url: 'https://shop.test/x' })
        });
        await Sentry.flush();
        expect(events[0]!.contexts?.error).toEqual({
            status: 404,
            url: 'https://shop.test/x'
        });
    });

    test('an error record without one reports its message', async () => {
        logger.error('card search failed', { card: 'Sol Ring' });
        await Sentry.flush();
        expect(events.map((e) => [e.message, e.level])).toEqual([
            ['card search failed', 'error']
        ]);
    });

    test('lower levels are not reported', async () => {
        logger.warn('parser found nothing', { shop: 'carton' });
        await Sentry.flush();
        expect(events).toEqual([]);
    });
});
