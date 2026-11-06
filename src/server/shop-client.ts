// One client shared by all card searchers. A deck list fans out to (cards × shops) requests, and firing them all at
// once gets us rate-limited (HTTP 429). So requests to each host are spaced out: each one starts at least
// `intervalMs` after the previous one to that host. Different hosts don't wait on each other.

// Keeps the status so callers can tell a block (403) from other failures.
export class HttpError extends Error {
    constructor(readonly status: number) {
        super(`HTTP ${status}`);
    }
}

export type ShopClientOptions = {
    defaultIntervalMs?: number;
    intervalMs?: Record<string, number>; // per-host overrides, e.g. { "kartoteka.in.ua": 500 }
    timeoutMs?: number; // per request, counted from when it actually starts (after waiting for its slot)
};

export class ShopClient {
    private readonly defaultIntervalMs: number;
    private readonly intervalMs: Record<string, number>;
    private readonly timeoutMs: number;
    private readonly nextSlot = new Map<string, number>(); // host → earliest time the next request may start

    constructor({
        defaultIntervalMs = 200,
        intervalMs = {},
        timeoutMs = 15_000
    }: ShopClientOptions = {}) {
        this.defaultIntervalMs = defaultIntervalMs;
        this.intervalMs = intervalMs;
        this.timeoutMs = timeoutMs;
    }

    // A hanging shop would otherwise keep its card's search (and the UI spinner) waiting forever.
    // The signal also covers reading the body, so a stalled res.text() times out too.
    async fetch(url: string, init?: RequestInit): Promise<Response> {
        await this.waitForSlot(new URL(url).host);
        try {
            return await fetch(url, {
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

    // Reserve the host's next slot synchronously (so concurrent callers queue up in call order), then sleep until it.
    private async waitForSlot(host: string): Promise<void> {
        const now = Date.now();
        const start = Math.max(now, this.nextSlot.get(host) ?? 0);
        this.nextSlot.set(
            host,
            start + (this.intervalMs[host] ?? this.defaultIntervalMs)
        );
        if (start > now) await Bun.sleep(start - now);
    }
}
