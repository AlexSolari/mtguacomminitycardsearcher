// When a shop goes down, every request to it waits out its full timeout (15 s), and a long list queues dozens of
// them: a CartOn outage once made a 62-card search take 166 s. So after FAILURES_TO_OPEN failures in a row (timeouts,
// dropped connections, 502/503/504), the circuit opens: for OPEN_MS, requests to the shop fail at once, including
// those already waiting for a slot. Then one request goes through as a probe: if the shop answers, requests flow
// again; if not, the circuit stays open for another OPEN_MS. Requests that arrive while the probe is out still fail.

export const FAILURES_TO_OPEN = 3;
export const OPEN_MS = 60_000;

// Short: it's shown to users, after the shop's name (SearchError.message).
export class ShopUnavailableError extends Error {
    override readonly name = 'ShopUnavailableError';

    constructor() {
        super('shop not responding');
    }
}

// How a request went, as far as the shop's health goes. `null`: it says nothing, e.g. the caller gave up, or it
// never reached the shop.
export type Verdict = 'up' | 'down' | null;

export class CircuitBreaker {
    private failures = 0;
    private openUntil: number | null = null; // set while open, and while the probe after it is out
    private probing = false;
    private controller = new AbortController();

    constructor(
        private readonly onOpen: () => void,
        private readonly failuresToOpen = FAILURES_TO_OPEN,
        private readonly openMs = OPEN_MS,
        private readonly now = () => Date.now()
    ) {}

    // Aborts when the circuit opens, so requests still waiting for a slot can leave the queue.
    get opened(): AbortSignal {
        return this.controller.signal;
    }

    // Throws while the circuit is open. Once OPEN_MS has passed, admits one request as the probe.
    admit(): void {
        if (this.openUntil === null) return;
        if (this.probing || this.now() < this.openUntil)
            throw new ShopUnavailableError();
        this.probing = true;
    }

    // Every admitted request settles exactly once.
    settle(verdict: Verdict): void {
        this.probing = false;
        if (verdict === 'up') {
            this.failures = 0;
            this.openUntil = null;
        } else if (verdict === 'down') {
            // a failed probe, or a request already out when the circuit opened, keeps it open
            if (
                this.openUntil !== null ||
                ++this.failures >= this.failuresToOpen
            )
                this.open();
        }
    }

    private open() {
        const wasClosed = this.openUntil === null;
        this.failures = 0;
        this.openUntil = this.now() + this.openMs;
        if (!wasClosed) return;
        this.controller.abort(new ShopUnavailableError());
        this.controller = new AbortController();
        this.onOpen();
    }
}
