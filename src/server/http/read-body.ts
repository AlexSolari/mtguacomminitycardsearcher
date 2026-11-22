// The request's body as text, or null when it's over `maxBytes` (or the read fails). It stops reading there:
// a chunked body has no Content-Length to check first, and a client can send a header that lies.
export async function readText(
    req: Request,
    maxBytes: number
): Promise<string | null> {
    if (Number(req.headers.get('content-length') ?? 0) > maxBytes) return null;
    if (!req.body) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        const reader = req.body.getReader(); // throws if the body was already read
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel(); // were it to throw, the catch below gives null all the same
                return null;
            }
            chunks.push(value);
        }
    } catch {
        return null;
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
}
