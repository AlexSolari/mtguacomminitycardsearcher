import { describe, expect, test } from 'bun:test';
import { ScryfallNameResolver } from '@/server/name-resolver';
import { HttpError, ShopClient } from '@/server/shop-client';
import { captureLogs } from './capture-logs';

const base = 'https://api.scryfall.com';

// A ShopClient whose JSON answers come from `answer` (by fuzzy query), recording each query and its options.
function fakeScryfall(answer: (fuzzy: string) => unknown) {
    const real = new ShopClient(base);
    const requests: { fuzzy: string; init?: RequestInit }[] = [];
    const client = {
        baseUrl: base,
        url: real.url.bind(real),
        fetchJson: async (url: string, init?: RequestInit) => {
            const fuzzy = new URL(url).searchParams.get('fuzzy')!;
            requests.push({ fuzzy, init });
            const res = answer(fuzzy);
            if (res instanceof Error) throw res;
            return res;
        }
    } as unknown as ShopClient;
    return { client, requests };
}

const logs = captureLogs();

describe('ScryfallNameResolver', () => {
    test('corrects a partial name to the card name', async () => {
        const { client, requests } = fakeScryfall(() => ({
            name: 'Overlord of the Balemurk'
        }));
        const resolver = new ScryfallNameResolver(client);
        expect(await resolver.resolve('overlord balemurk')).toBe(
            'Overlord of the Balemurk'
        );
        expect(requests[0]!.fuzzy).toBe('overlord balemurk');
        expect(requests[0]!.init?.headers).toMatchObject({
            Accept: 'application/json'
        });
    });

    test('keeps the typed name when it already is the card', async () => {
        const { client } = fakeScryfall(() => ({ name: 'Æther Vial' }));
        const resolver = new ScryfallNameResolver(client);
        expect(await resolver.resolve('aether vial')).toBe('aether vial');
    });

    test('a double-faced card: the front face, or the face typed', async () => {
        const delver = {
            name: 'Delver of Secrets // Insectile Aberration',
            card_faces: [
                { name: 'Delver of Secrets' },
                { name: 'Insectile Aberration' }
            ]
        };
        const resolver = new ScryfallNameResolver(
            fakeScryfall(() => delver).client
        );
        expect(await resolver.resolve('delver of secret')).toBe(
            'Delver of Secrets'
        );
        expect(await resolver.resolve('Insectile Aberration')).toBe(
            'Insectile Aberration'
        );
    });

    test('an unknown or ambiguous name (404) is searched as typed, and remembered', async () => {
        const { client, requests } = fakeScryfall(() => new HttpError(404));
        const resolver = new ScryfallNameResolver(client);
        expect(await resolver.resolve('Сол Рінг')).toBe('Сол Рінг');
        expect(await resolver.resolve('сол рінг')).toBe('Сол Рінг');
        expect(requests).toHaveLength(1);
        expect(logs).toEqual([]);
    });

    test('caches resolved names by their normalized form', async () => {
        const { client, requests } = fakeScryfall(() => ({
            name: 'Overlord of the Balemurk'
        }));
        const resolver = new ScryfallNameResolver(client);
        await resolver.resolve('overlord balemurk');
        expect(await resolver.resolve('Overlord  Balemurk!')).toBe(
            'Overlord of the Balemurk'
        );
        expect(requests).toHaveLength(1);
    });

    test('evicts the oldest name once the cache is full', async () => {
        const { client, requests } = fakeScryfall((q) => ({ name: q }));
        const resolver = new ScryfallNameResolver(client);
        for (let i = 0; i <= 10_000; i++) await resolver.resolve(`card ${i}`);
        await resolver.resolve('card 0');
        await resolver.resolve('card 10000');
        expect(requests).toHaveLength(10_002);
    });

    test('any other failure is logged, searched as typed, and retried next time', async () => {
        const { client, requests } = fakeScryfall(() => new HttpError(503));
        const resolver = new ScryfallNameResolver(client);
        expect(await resolver.resolve('Sol Ring')).toBe('Sol Ring');
        await resolver.resolve('Sol Ring');
        expect(requests).toHaveLength(2);
        expect(logs[0]).toMatchObject({
            level: 'warn',
            message: 'name lookup failed, searching as typed',
            card: 'Sol Ring'
        });
    });

    test('an aborted search rejects instead of falling back', async () => {
        const controller = new AbortController();
        controller.abort();
        const { client, requests } = fakeScryfall(() => new Error('aborted'));
        const resolver = new ScryfallNameResolver(client);
        await expect(
            resolver.resolve('Sol Ring', controller.signal)
        ).rejects.toThrow('aborted');
        expect(requests[0]!.init?.signal).toBe(controller.signal);
        expect(logs).toEqual([]);
    });

    test('uses its own rate-limited client by default', () => {
        expect(() => new ScryfallNameResolver()).not.toThrow();
    });
});
