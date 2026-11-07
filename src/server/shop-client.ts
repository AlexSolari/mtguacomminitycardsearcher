// Each card searcher owns one client, so every shop gets its own request queue. A deck list fans out to
// (cards × shops) requests, and firing them all at once gets us rate-limited (HTTP 429). So requests to a shop
// are spaced out: each one starts at least `intervalMs` after the previous one. Shops don't wait on each other.

// Keeps the status so callers can tell a block (403) from other failures.
export class HttpError extends Error {
    constructor(readonly status: number) {
        super(`HTTP ${status}`);
    }
}

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
    private nextSlot = 0; // earliest time the next request may start

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
    }

    // ("/search", { q: "Sol Ring" }) → "https://carton.cards/search?q=Sol+Ring"
    url(path: string, params?: Record<string, string>): string {
        const url = new URL(path, this.baseUrl);
        if (params) url.search = new URLSearchParams(params).toString();
        return url.href;
    }

    // A hanging shop would otherwise keep its card's search (and the UI spinner) waiting forever.
    // The signal also covers reading the body, so a stalled res.text() times out too.
    // Takes a path or an absolute URL on the shop's own host. Another host would dodge that host's rate limit.
    async fetch(url: string, init?: RequestInit): Promise<Response> {
        const target = new URL(url, this.baseUrl);
        if (target.host !== this.host)
            throw new Error(`${target.host} is not ${this.host}`);
        await this.waitForSlot();
        try {
            return await fetch(target, {
                signal: AbortSignal.timeout(this.timeoutMs),
                ...init
            });
        } catch (err) {
            if ((err as Error).name === 'TimeoutError')
                throw new Error(`timeout after ${this.timeoutMs / 1000}s`);
            throw err;
        }
    }

    async fetchHtml(url: string): Promise<string> {
        const res = await this.fetch(url);
        if (!res.ok) throw new HttpError(res.status);
        return res.text();
    }

    async fetchJson<T = unknown>(url: string): Promise<T> {
        const res = await this.fetch(url);
        if (!res.ok) throw new HttpError(res.status);
        return res.json() as Promise<T>;
    }

    // Reserve the next slot synchronously (so concurrent callers queue up in call order), then sleep until it.
    // The queue is shared by every user, so its backlog is capped: past `maxWaitMs`, a request fails fast instead
    // of growing the queue. Otherwise a flood of searches would push every later search minutes back.
    private async waitForSlot(): Promise<void> {
        const now = Date.now();
        const start = Math.max(now, this.nextSlot);
        if (start - now > this.maxWaitMs) throw new Error('server busy');
        this.nextSlot = start + this.intervalMs;
        if (start > now) await Bun.sleep(start - now);
    }
}
