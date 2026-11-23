// Behind a proxy (Railway) every connection comes from the proxy, so the client is the address the proxy
// appended last to X-Forwarded-For. Earlier entries are whatever the client sent, so they can't be trusted.
// `peer` is the connection's own address, used when there's no proxy.
// The limits are per client, so an IPv6 client is its /64 (see clientKey).
export function clientId(req: Request, peer: string | undefined) {
    const forwarded = req.headers.get('x-forwarded-for');
    const last = forwarded?.split(',').at(-1)?.trim();
    return clientKey(last || peer || 'unknown');
}

// An IPv6 address's first 64 bits: an ISP hands each customer a /64 (or more), so its owner can pick a new address
// in it for every request, and limits keyed on the whole address wouldn't hold. An IPv4-mapped address is its IPv4;
// anything that doesn't parse is kept as it is.
export function clientKey(address: string): string {
    if (!address.includes(':')) return address;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return mapped[1]!;
    const parts = address.replace(/%.*$/, '').toLowerCase().split('::');
    if (parts.length > 2) return address;
    const head = parts[0] ? parts[0].split(':') : [];
    const tail = parts[1] ? parts[1].split(':') : [];
    // `::` stands for at least one group of zeros
    if (parts.length === 2 && head.length + tail.length > 7) return address;
    const groups =
        parts.length === 2
            ? [
                  ...head,
                  ...Array<string>(8 - head.length - tail.length).fill('0'),
                  ...tail
              ]
            : head;
    if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)))
        return address;
    return `${groups
        .slice(0, 4)
        .map((g) => parseInt(g, 16).toString(16))
        .join(':')}::/64`;
}
