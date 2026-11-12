// A request budget for an API that allows `capacity` requests in a fixed window opened by its first request, then
// starts over at the next request (Mana Vault: 60 a minute, counted from the first, not from :00 and not rolling).
// Requests go out at once while the window has budget left, so a search that fits doesn't wait at all; once it's
// spent, requests wait for the next window.
//
// The API opens its window when it *receives* the first request, which we can't see. It's always before that request
// settles here, so the window is timed from then: our window then never ends before the API's does.
// A request that straddles the boundary (sent in our window, received in the API's next) isn't counted in our next
// window, so `capacity` should stay below the API's limit by the most one request can cost.
export class WindowBudget {
    private used = 0;
    private windowEnd = 0; // when the current window ends; Infinity while its first request is in flight
    private opening = false; // the window's first request hasn't settled yet

    constructor(
        private readonly capacity: number,
        private readonly windowMs: number,
        // a request that would wait longer than this for the next window fails at once (as ShopClient's queue does)
        private readonly maxWaitMs = 30_000,
        private readonly now = () => Date.now()
    ) {}

    // Runs `fn` once `cost` fits in the window.
    async run<T>(
        cost: number,
        fn: () => Promise<T>,
        signal?: AbortSignal
    ): Promise<T> {
        await this.acquire(cost, signal);
        try {
            return await fn();
        } finally {
            if (this.opening) {
                this.opening = false;
                this.windowEnd = this.now() + this.windowMs;
            }
        }
    }

    // After a 429 the API has counted more than we have (another client on our IP, clock drift): nothing more goes
    // out until the window ends.
    exhaust() {
        this.used = this.capacity;
    }

    private async acquire(cost: number, signal?: AbortSignal) {
        for (;;) {
            signal?.throwIfAborted();
            const now = this.now();
            if (!this.opening && now >= this.windowEnd) {
                this.used = 0;
                this.opening = true;
                this.windowEnd = Infinity;
            }
            if (this.used + cost <= this.capacity) {
                this.used += cost;
                return;
            }
            const wait = this.windowEnd - now;
            if (wait > this.maxWaitMs) throw new Error('server busy');
            await sleep(wait, signal);
        }
    }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal!.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
