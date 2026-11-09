// Against a local server, never the real shops.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { HttpError, ShopClient } from '@/server/shop-client';
import { captureSpans } from './capture-spans';

const hits: { path: string; at: number }[] = [];
const server = Bun.serve({
    port: 0,
    async fetch(req) {
        const path = new URL(req.url).pathname;
        hits.push({ path, at: Date.now() });
        if (path === '/slow') await Bun.sleep(1000);
        if (path === '/missing') return new Response('nope', { status: 404 });
        if (path === '/json')
            return Response.json({ key: req.headers.get('x-api-key') });
        return new Response(`page ${path}`);
    }
});
const base = `http://localhost:${server.port}`;
afterAll(() => server.stop(true));
beforeEach(() => {
    hits.length = 0;
});

const paths = () => hits.map((h) => h.path);
const spans = captureSpans();

describe('ShopClient', () => {
    test('url() resolves paths and encodes params', () => {
        const client = new ShopClient('https://carton.cards');
        expect(client.url('/search', { q: 'Sol Ring' })).toBe(
            'https://carton.cards/search?q=Sol+Ring'
        );
    });

    test('refuses URLs on other hosts', async () => {
        const client = new ShopClient(base);
        await expect(client.fetchHtml('https://example.com/')).rejects.toThrow(
            'is not'
        );
        expect(hits).toHaveLength(0);
    });

    test('spaces request starts, in call order', async () => {
        const client = new ShopClient(base, { intervalMs: 50 });
        await client.fetchHtml('/warm-up'); // the first connection's setup would skew the first gap
        hits.length = 0;
        await Promise.all(
            ['/a', '/b', '/c', '/d'].map((p) => client.fetchHtml(p))
        );
        expect(paths()).toEqual(['/a', '/b', '/c', '/d']);
        for (let i = 1; i < hits.length; i++)
            expect(hits[i]!.at - hits[i - 1]!.at).toBeGreaterThanOrEqual(45);
    });

    test('HTTP errors keep their status', async () => {
        const client = new ShopClient(base);
        for (const fetchPage of [client.fetchHtml, client.fetchJson]) {
            const err = await fetchPage
                .call(client, '/missing')
                .catch((e) => e);
            expect(err).toBeInstanceOf(HttpError);
            expect(err.status).toBe(404);
        }
    });

    test('fetchJson parses the body and sends the given headers', async () => {
        const client = new ShopClient(base);
        expect(
            await client.fetchJson('/json', { headers: { 'X-API-Key': 'k' } })
        ).toEqual({ key: 'k' });
    });

    test('an aborted request leaves the queue and is never sent', async () => {
        const client = new ShopClient(base, { intervalMs: 100 });
        const controller = new AbortController();
        const t0 = Date.now();
        const a = client.fetchHtml('/a');
        const b = client.fetchHtml('/b', { signal: controller.signal });
        const c = client.fetchHtml('/c');
        setTimeout(() => controller.abort(), 20);
        await expect(b).rejects.toHaveProperty('name', 'AbortError');
        await Promise.all([a, c]);
        expect(paths()).toEqual(['/a', '/c']);
        // '/c' took '/b''s place: it starts one interval in, not two
        expect(hits[1]!.at - t0).toBeLessThan(180);
    });

    test('an already-aborted signal rejects without a request', async () => {
        const client = new ShopClient(base);
        await expect(
            client.fetchHtml('/a', { signal: AbortSignal.abort() })
        ).rejects.toHaveProperty('name', 'AbortError');
        expect(hits).toHaveLength(0);
    });

    test('fails fast with "server busy" past maxWaitMs', async () => {
        const client = new ShopClient(base, {
            intervalMs: 100,
            maxWaitMs: 250
        });
        const results = await Promise.allSettled(
            ['/1', '/2', '/3', '/4', '/5'].map((p) => client.fetchHtml(p))
        );
        const busy = results.filter(
            (r) => r.status === 'rejected' && r.reason.message === 'server busy'
        );
        expect(busy).toHaveLength(2);
        expect(paths()).toEqual(['/1', '/2', '/3']);
    });

    test('times out, also when the caller passes its own signal', async () => {
        const client = new ShopClient(base, { timeoutMs: 100 });
        await expect(
            client.fetchHtml('/slow', { signal: new AbortController().signal })
        ).rejects.toThrow('timeout after 0.1s');
    });

    test("the caller's signal aborts a running request", async () => {
        const client = new ShopClient(base, { timeoutMs: 5000 });
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 50);
        await expect(
            client.fetchHtml('/slow', { signal: controller.signal })
        ).rejects.toHaveProperty('name', 'AbortError');
    });
});

describe('ShopClient spans', () => {
    test('each request gets a client span that includes its wait for a slot', async () => {
        const client = new ShopClient(base, { intervalMs: 100 });
        await Promise.all([client.fetchHtml('/a'), client.fetchHtml('/b')]);
        const [a, b] = spans();
        const host = `localhost:${server.port}`;
        expect(a).toMatchObject({
            name: `GET ${host}`,
            kind: SpanKind.CLIENT,
            attributes: {
                'http.request.method': 'GET',
                'server.address': host,
                'url.full': `${base}/a`,
                'http.response.status_code': 200
            },
            status: { code: SpanStatusCode.UNSET }
        });
        expect(a!.attributes['shop.queue_wait_ms']).toBeLessThan(50);
        // '/b' waited an interval for its slot, inside its span
        expect(b!.attributes['shop.queue_wait_ms']).toBeGreaterThanOrEqual(90);
    });

    test('"server busy" is an error span', async () => {
        // the third would wait two intervals, past maxWaitMs
        const client = new ShopClient(base, {
            intervalMs: 100,
            maxWaitMs: 150
        });
        await Promise.allSettled(
            ['/1', '/2', '/3'].map((p) => client.fetchHtml(p))
        );
        const errors = spans().filter(
            (s) => s.status.code === SpanStatusCode.ERROR
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]!.events).toMatchObject([
            {
                name: 'exception',
                attributes: { 'exception.message': 'server busy' }
            }
        ]);
    });

    test('a timeout is an error span', async () => {
        const client = new ShopClient(base, { timeoutMs: 100 });
        await client.fetchHtml('/slow').catch(() => {});
        expect(spans()[0]!.status.code).toBe(SpanStatusCode.ERROR);
    });

    test('a caller giving up is an `aborted` event, not an error, in the queue or mid-request', async () => {
        const client = new ShopClient(base, { timeoutMs: 5000 });
        await client
            .fetchHtml('/a', { signal: AbortSignal.abort() })
            .catch(() => {});
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 50);
        await client
            .fetchHtml('/slow', { signal: controller.signal })
            .catch(() => {});
        expect(spans()).toHaveLength(2);
        for (const span of spans()) {
            expect(span.status.code).toBe(SpanStatusCode.UNSET);
            expect(span.events.map((e) => e.name)).toEqual(['aborted']);
        }
    });
});
