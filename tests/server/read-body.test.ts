import { describe, expect, test } from 'bun:test';
import { readText } from '@/server/read-body';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
    new Request('http://localhost/', { method: 'POST', body, headers });

// a body sent in chunks, with no Content-Length, as a chunked request arrives
function chunked(...chunks: string[]) {
    const pulled: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            const next = chunks.shift();
            if (next === undefined) return controller.close();
            pulled.push(next);
            controller.enqueue(new TextEncoder().encode(next));
        }
    });
    return { req: post(stream), pulled };
}

describe('readText', () => {
    test('reads a body within the limit, and an empty one', async () => {
        expect(await readText(post('{"a":1}'), 10)).toBe('{"a":1}');
        expect(await readText(post(null), 10)).toBe('');
    });

    test('counts bytes, not characters', async () => {
        // 3 characters, 6 bytes in UTF-8
        expect(await readText(post('їжа'), 6)).toBe('їжа');
        expect(await readText(post('їжа'), 5)).toBeNull();
    });

    test('a Content-Length over the limit is refused before reading', async () => {
        const { req } = chunked('x');
        req.headers.set('content-length', '100');
        expect(await readText(req, 10)).toBeNull();
        expect(req.bodyUsed).toBe(false);
    });

    test('a chunked body stops being read once it passes the limit', async () => {
        const { req, pulled } = chunked('12345', '67890', 'abcde', 'fghij');
        expect(await readText(req, 8)).toBeNull();
        // the stream may pull one chunk ahead, but never to the end
        expect(pulled).not.toContain('fghij');
    });

    test('a chunked body within the limit is read whole', async () => {
        const { req } = chunked('ab', 'cd');
        expect(await readText(req, 4)).toBe('abcd');
    });

    test('a Content-Length that lies, or isn’t a number, is caught by the actual size', async () => {
        const body = 'x'.repeat(50);
        expect(
            await readText(post(body, { 'content-length': '5' }), 10)
        ).toBeNull();
        const req = post(body);
        req.headers.set('content-length', 'abc');
        expect(await readText(req, 10)).toBeNull();
    });

    test('a body already read is null', async () => {
        const req = post('{}');
        await req.text();
        expect(await readText(req, 10)).toBeNull();
    });

    test('a body that fails mid-read is null', async () => {
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.error(new Error('connection reset'));
            }
        });
        expect(await readText(post(stream), 10)).toBeNull();
    });
});
