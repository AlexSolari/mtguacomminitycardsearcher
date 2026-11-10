import { SpanKind } from '@opentelemetry/api';
import PQueue from 'p-queue';
import { withSpan } from './tracing';

// Each card searcher owns one client, so every shop gets its own request queue. A deck list fans out to
// (cards × shops) requests, and firing them all at once gets us rate-limited (HTTP 429). So requests to a shop
// are spaced out: each one starts at least `intervalMs` after the previous one. Shops don't wait on each other.

export type RequestDetails = {
    url?: string;
    method?: string;
    contentType?: string;
    body?: string; // the start of the response body, see bodySnippet
    cause?: unknown;
};

// A failed shop request, with what the logs need to tell why: the request, and the response's type and the start of
// its body (an API's 400, or the HTML page a JSON API served instead, usually says what went wrong). The logger
// keeps these fields (serializeError). The message stays short, since it's shown to users (SearchError.message).
export class ShopRequestError extends Error {
    readonly url?: string;
    readonly method?: string;
    readonly contentType?: string;
    readonly body?: string;

    constructor(message: string, { cause, ...details }: RequestDetails = {}) {
        super(message, cause === undefined ? undefined : { cause });
        this.url = details.url;
        this.method = details.method;
        this.contentType = details.contentType;
        this.body = details.body;
    }
}

// Keeps the status so callers can tell a block (403) from other failures.
export class HttpError extends ShopRequestError {
    override readonly name = 'HttpError';

    constructor(
        readonly status: number,
        details?: RequestDetails
    ) {
        super(`HTTP ${status}`, details);
    }
}

// A 200 whose body isn't the JSON asked for, typically a bot challenge or maintenance page served as HTML.
export class InvalidJsonError extends ShopRequestError {
    override readonly name = 'InvalidJsonError';
}

export class RequestTimeoutError extends ShopRequestError {
    override readonly name = 'RequestTimeoutError';
}

// Enough to show an API's error message, short of logging a whole HTML error page.
const MAX_ERROR_BODY = 500;

const bodySnippet = (text: string) =>
    text.length > MAX_ERROR_BODY
        ? `${text.slice(0, MAX_ERROR_BODY)}…`
        : text || undefined;

const responseDetails = (res: Response, method = 'GET') => ({
    url: res.url,
    method,
    contentType: res.headers.get('content-type') ?? undefined
});

export type ShopClientOptions = {
    intervalMs?: number; // minimum gap between request starts, e.g. 500 for a touchier shop
    timeoutMs?: number; // per request, counted from when it actually starts (after waiting for its slot)
    maxWaitMs?: number; // a request that would wait longer than this for its slot fails at once (see waitForSlot)
};

export class ShopClient {
    private readonly intervalMs: number;
    private readonly timeoutMs: number;
    private readonly maxWaitMs: number;
    private readonly host: string;
    // Only the starts are queued (see waitForSlot), one per `intervalMs`. `strict` counts actual start times in a
    // sliding window, so two requests can't start back to back at a window boundary.
    private readonly queue: PQueue;

    // `baseUrl` is the shop's origin, e.g. "https://carton.cards"; paths and `url()` resolve against it.
    constructor(
        readonly baseUrl: string,
        {
            intervalMs = 200,
            timeoutMs = 15_000,
            maxWaitMs = 30_000
        }: ShopClientOptions = {}
    ) {
        this.host = new URL(baseUrl).host;
        this.intervalMs = intervalMs;
        this.timeoutMs = timeoutMs;
        this.maxWaitMs = maxWaitMs;
        this.queue = new PQueue({
            interval: intervalMs,
            intervalCap: 1,
            strict: true
        });
    }

    // ("/search", { q: "Sol Ring" }) → "https://carton.cards/search?q=Sol+Ring"
    url(path: string, params?: Record<string, string>): string {
        const url = new URL(path, this.baseUrl);
        if (params) url.search = new URLSearchParams(params).toString();
        return url.href;
    }

    // A hanging shop would otherwise keep its card's search (and the UI spinner) waiting forever.
    // The timeout signal also covers reading the body, so a stalled res.text() times out too.
    // `init.signal` (the caller giving up) is honoured alongside it, both in the queue and during the request.
    // Takes a path or an absolute URL on the shop's own host. Another host would dodge that host's rate limit.
    async fetch(url: string, init: RequestInit = {}): Promise<Response> {
        const target = new URL(url, this.baseUrl);
        if (target.host !== this.host)
            throw new Error(`${target.host} is not ${this.host}`);
        const { signal, ...rest } = init;
        // Bun's fetch isn't auto-instrumented, so each shop request gets its own client span by hand. It starts
        // before the wait for a slot: the queue is often most of a request's time, and "server busy" happens there.
        return withSpan(
            `${rest.method ?? 'GET'} ${this.host}`,
            SpanKind.CLIENT,
            {
                'http.request.method': rest.method ?? 'GET',
                'server.address': this.host,
                'url.full': target.href
            },
            async (span) => {
                const queued = performance.now();
                await this.waitForSlot(signal ?? undefined);
                span.setAttribute(
                    'shop.queue_wait_ms',
                    Math.round(performance.now() - queued)
                );
                const timeout = AbortSignal.timeout(this.timeoutMs);
                try {
                    return await fetch(target, {
                        ...rest,
                        signal: signal
                            ? AbortSignal.any([signal, timeout])
                            : timeout
                    });
                } catch (err) {
                    if (timeout.aborted)
                        throw this.timeoutError(err, {
                            url: target.href,
                            method: rest.method ?? 'GET'
                        });
                    throw err;
                }
            },
            { statusOf: (res) => res.status, signal: signal ?? undefined }
        );
    }

    async fetchHtml(url: string, init?: RequestInit): Promise<string> {
        const res = await this.fetch(url, init);
        const text = await this.readBody(res, init?.method);
        if (!res.ok)
            throw new HttpError(res.status, {
                ...responseDetails(res, init?.method),
                body: bodySnippet(text)
            });
        return text;
    }

    // Parsed from the text rather than with res.json(), so a body that isn't JSON can be shown in the error.
    async fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
        const res = await this.fetch(url, init);
        const text = await this.readBody(res, init?.method);
        const details = () => ({
            ...responseDetails(res, init?.method),
            body: bodySnippet(text)
        });
        if (!res.ok) throw new HttpError(res.status, details());
        try {
            return JSON.parse(text) as T;
        } catch (err) {
            const type = res.headers.get('content-type')?.split(';')[0];
            throw new InvalidJsonError(
                type ? `expected JSON, got ${type}` : 'expected JSON',
                { ...details(), cause: err }
            );
        }
    }

    // The timeout signal also covers the body, so a stalled read is a timeout too, not a bare DOMException.
    // An error body that fails to read is a best effort: the status still says enough.
    private async readBody(res: Response, method?: string): Promise<string> {
        try {
            return await res.text();
        } catch (err) {
            if (!res.ok) return '';
            if ((err as Error)?.name === 'TimeoutError')
                throw this.timeoutError(err, responseDetails(res, method));
            throw err;
        }
    }

    private timeoutError(cause: unknown, details: RequestDetails) {
        return new RequestTimeoutError(
            `timeout after ${this.timeoutMs / 1000}s`,
            { ...details, cause }
        );
    }

    // Resolves when this request may start. The queued task is empty: the queue only spaces out the starts, and
    // the fetch itself runs outside it. A request whose caller gives up leaves the queue (p-queue drops a task
    // whose signal aborts while it waits), freeing its place for the requests behind it.
    // The queue is shared by every user, so its backlog is capped: past `maxWaitMs`, a request fails fast instead
    // of growing the queue. Otherwise a flood of searches would push every later search minutes back.
    private async waitForSlot(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        // estimated wait at the back of the queue: one interval per queued request, plus one if the current
        // interval's start is already taken
        const ahead = this.queue.size + (this.queue.isRateLimited ? 1 : 0);
        if (ahead * this.intervalMs > this.maxWaitMs)
            throw new Error('server busy');
        await this.queue.add(() => {}, { signal });
    }
}
