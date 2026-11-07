import PQueue from 'p-queue';

// Caps how many cards one client can have searching at once. The shop queues are shared by every user, and the
// browser's own cap (CONCURRENT_CARDS in use-card-search.ts) only binds our frontend, so a script could
// otherwise fill the queues and leave everyone else with "server busy".
// Cards over the cap aren't refused: they wait their turn (first come, first served) and start as running ones
// finish. A waiting card leaves the queue when its request is cancelled (e.g. the client disconnects).
export class InFlightLimiter {
    private readonly clients = new Map<string, PQueue>();

    constructor(private readonly max: number) {}

    // Runs `fn` once `client` has a free slot; the slot is freed when it settles or `signal` aborts.
    run<T>(
        client: string,
        fn: () => Promise<T>,
        signal?: AbortSignal
    ): Promise<T> {
        return this.queueFor(client).add(fn, { signal });
    }

    // One queue per client, dropped once it has nothing running or waiting, so the map doesn't keep every
    // address ever seen.
    private queueFor(client: string): PQueue {
        let queue = this.clients.get(client);
        if (!queue) {
            const created = new PQueue({ concurrency: this.max });
            created.addEventListener('idle', () => {
                if (this.clients.get(client) === created)
                    this.clients.delete(client);
            });
            this.clients.set(client, created);
            queue = created;
        }
        return queue;
    }
}
