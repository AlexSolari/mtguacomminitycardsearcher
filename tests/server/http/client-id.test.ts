import { describe, expect, test } from 'bun:test';
import { clientId, clientKey } from '@/server/http/client-id';

describe('clientId', () => {
    const req = (forwarded?: string) =>
        new Request('http://localhost/', {
            headers: forwarded ? { 'x-forwarded-for': forwarded } : {}
        });

    test('trusts only the last X-Forwarded-For entry, the one the proxy added', () => {
        expect(clientId(req('6.6.6.6, 10.0.0.1 , 1.2.3.4 '), '9.9.9.9')).toBe(
            '1.2.3.4'
        );
    });

    test('without the header, the connection address', () => {
        expect(clientId(req(), '9.9.9.9')).toBe('9.9.9.9');
        expect(clientId(req(''), '9.9.9.9')).toBe('9.9.9.9');
    });

    test('with neither, a shared fallback', () => {
        expect(clientId(req(), undefined)).toBe('unknown');
    });

    test('an IPv6 client is its /64', () => {
        expect(clientId(req('2001:db8:1:2:aaaa::1'), undefined)).toBe(
            '2001:db8:1:2::/64'
        );
        expect(clientId(req(), '2001:db8:1:2:bbbb::2')).toBe(
            '2001:db8:1:2::/64'
        );
    });
});

describe('clientKey', () => {
    test('an IPv4 address is kept', () => {
        expect(clientKey('1.2.3.4')).toBe('1.2.3.4');
    });

    test('an IPv6 address becomes its /64, however it is written', () => {
        for (const address of [
            '2001:0db8:0001:0002:0000:0000:0000:0001',
            '2001:DB8:1:2::1',
            '2001:db8:1:2:ffff:ffff:ffff:ffff',
            '2001:db8:1:2::1%eth0'
        ])
            expect(clientKey(address), address).toBe('2001:db8:1:2::/64');
        expect(clientKey('::1')).toBe('0:0:0:0::/64');
        expect(clientKey('2001:db8::')).toBe('2001:db8:0:0::/64');
    });

    test('an IPv4-mapped address is its IPv4', () => {
        expect(clientKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
    });

    test("what doesn't parse as IPv6 is kept as it is", () => {
        for (const address of [
            '1::2::3',
            '1:2:3:4:5:6:7:8::9',
            '1:2:3',
            '2001:db8:zz::1',
            '64:ff9b::1.2.3.4'
        ])
            expect(clientKey(address)).toBe(address);
    });
});
