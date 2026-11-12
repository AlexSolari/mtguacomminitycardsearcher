import { describe, expect, test } from 'bun:test';
import {
    RATE_LIMIT_PAUSE_MS,
    ScryfallNameResolver
} from '@/server/name-resolver';
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
        expect(await resolver.resolve('overlord balemurk')).toEqual({
            name: 'Overlord of the Balemurk',
            fullName: 'Overlord of the Balemurk'
        });
        expect(requests[0]!.fuzzy).toBe('overlord balemurk');
        expect(requests[0]!.init?.headers).toMatchObject({
            Accept: 'application/json'
        });
    });

    test('keeps the typed name when it already is the card', async () => {
        const { client } = fakeScryfall(() => ({ name: 'Æther Vial' }));
        const resolver = new ScryfallNameResolver(client);
        expect(await resolver.resolve('aether vial')).toEqual({
            name: 'aether vial',
            fullName: 'Æther Vial'
        });
    });

    test('a double-faced card: the front face, or the face typed, and the full name', async () => {
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
        expect(await resolver.resolve('delver of secret')).toEqual({
            name: 'Delver of Secrets',
            fullName: delver.name
        });
        expect(await resolver.resolve('Insectile Aberration')).toEqual({
            name: 'Insectile Aberration',
            fullName: delver.name
        });
    });

    test('an unknown or ambiguous name (404) is searched as typed, and remembered', async () => {
        const { client, requests } = fakeScryfall(() => new HttpError(404));
        const resolver = new ScryfallNameResolver(client);
        const asTyped = { name: 'Сол Рінг', fullName: 'Сол Рінг' };
        expect(await resolver.resolve('Сол Рінг')).toEqual(asTyped);
        expect(await resolver.resolve('сол рінг')).toEqual(asTyped);
        expect(requests).toHaveLength(1);
        expect(logs).toEqual([]);
    });

    test('caches resolved names by their normalized form', async () => {
        const { client, requests } = fakeScryfall(() => ({
            name: 'Overlord of the Balemurk'
        }));
        const resolver = new ScryfallNameResolver(client);
        await resolver.resolve('overlord balemurk');
        expect(await resolver.resolve('Overlord  Balemurk!')).toMatchObject({
            name: 'Overlord of the Balemurk'
        });
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
        expect(await resolver.resolve('Sol Ring')).toEqual({
            name: 'Sol Ring',
            fullName: 'Sol Ring'
        });
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

describe('ScryfallNameResolver.resolveAll', () => {
    const delver = {
        name: 'Delver of Secrets // Insectile Aberration',
        card_faces: [
            { name: 'Delver of Secrets' },
            { name: 'Insectile Aberration' }
        ]
    };
    const known: Record<string, object> = {
        'sol ring': { name: 'Sol Ring' },
        daze: { name: 'Daze' },
        opt: { name: 'Opt' },
        'delver of secrets': delver,
        'insectile aberration': delver
    };

    // POST /cards/collection finds the names in `known` (by lower-cased name); GET /cards/named?fuzzy= answers
    // `fuzzy`, or 404. `collection` records each POST's names, `fuzzy` each GET's query.
    function fakeCollection(
        fuzzy: (q: string) => unknown = () => new HttpError(404),
        collectionFails?: Error
    ) {
        const real = new ShopClient(base);
        const calls = { collection: [] as string[][], fuzzy: [] as string[] };
        const client = {
            baseUrl: base,
            url: real.url.bind(real),
            fetchJson: async (url: string, init?: RequestInit) => {
                if (init?.method === 'POST') {
                    const names = (
                        JSON.parse(init.body as string).identifiers as {
                            name: string;
                        }[]
                    ).map((i) => i.name);
                    calls.collection.push(names);
                    if (collectionFails) throw collectionFails;
                    return {
                        data: names.flatMap((n) => known[n.toLowerCase()] ?? [])
                    };
                }
                const q = new URL(url).searchParams.get('fuzzy')!;
                calls.fuzzy.push(q);
                const res = fuzzy(q);
                if (res instanceof Error) throw res;
                return res;
            }
        } as unknown as ShopClient;
        return { client, calls };
    }

    test('looks the list up in one request, either face of a card, and only misses one by one', async () => {
        const { client, calls } = fakeCollection(() => ({
            name: 'Overlord of the Balemurk'
        }));
        const resolver = new ScryfallNameResolver(client, undefined, client);
        const names = await Promise.all(
            resolver.resolveAll([
                'sol ring',
                'Insectile Aberration',
                'overlord balemurk'
            ])
        );
        expect(names).toEqual([
            { name: 'sol ring', fullName: 'Sol Ring' },
            { name: 'Insectile Aberration', fullName: delver.name },
            {
                name: 'Overlord of the Balemurk',
                fullName: 'Overlord of the Balemurk'
            }
        ]);
        expect(calls.collection).toEqual([
            ['sol ring', 'Insectile Aberration', 'overlord balemurk']
        ]);
        expect(calls.fuzzy).toEqual(['overlord balemurk']);
    });

    test('remembers what it found, and asks once per name', async () => {
        const { client, calls } = fakeCollection();
        const resolver = new ScryfallNameResolver(client, undefined, client);
        await Promise.all(
            resolver.resolveAll(['Sol Ring', 'sol ring', 'Daze', 'Opt'])
        );
        await Promise.all(resolver.resolveAll(['SOL RING']));
        expect(calls.collection).toEqual([['Sol Ring', 'Daze', 'Opt']]);
        expect(await resolver.resolve('sol ring')).toEqual({
            name: 'sol ring',
            fullName: 'Sol Ring'
        });
        expect(calls.fuzzy).toEqual([]);
    });

    test('sends 75 names per request', async () => {
        const { client, calls } = fakeCollection();
        const resolver = new ScryfallNameResolver(client, undefined, client);
        const cards = Array.from({ length: 80 }, (_, i) => `Card ${i}`);
        await Promise.all(resolver.resolveAll(cards));
        expect(calls.collection.map((c) => c.length)).toEqual([75, 5]);
        expect(calls.fuzzy).toHaveLength(80);
    });

    test('a failed lookup is logged, and its names are looked up one by one', async () => {
        const { client, calls } = fakeCollection(
            () => ({ name: 'Sol Ring' }),
            new HttpError(503)
        );
        const resolver = new ScryfallNameResolver(client, undefined, client);
        expect(
            (await Promise.all(resolver.resolveAll(['sol ring', 'x', 'y'])))[0]
        ).toEqual({ name: 'sol ring', fullName: 'Sol Ring' });
        expect(calls.fuzzy).toEqual(['sol ring', 'x', 'y']);
        expect(logs[0]).toMatchObject({
            level: 'warn',
            message: 'bulk name lookup failed, looking names up one by one',
            count: 3
        });
    });

    test('an aborted lookup rejects every name it holds', async () => {
        const controller = new AbortController();
        controller.abort();
        const { client } = fakeCollection(undefined, new Error('aborted'));
        const resolver = new ScryfallNameResolver(client, undefined, client);
        const results = await Promise.allSettled(
            resolver.resolveAll(['Sol Ring', 'Daze'], controller.signal)
        );
        expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
        expect(logs).toEqual([]);
    });

    test('a list already known sends nothing', async () => {
        const { client, calls } = fakeCollection();
        const resolver = new ScryfallNameResolver(client, undefined, client);
        await resolver.resolve('Daze');
        await Promise.all(resolver.resolveAll(['Daze']));
        expect(calls.collection).toEqual([]);
    });
});

describe('ScryfallNameResolver after a 429', () => {
    test('stops asking Scryfall for a while, searching names as typed, and logs it once', async () => {
        let now = 0;
        let status = 429;
        const requests: string[] = [];
        const real = new ShopClient(base);
        const client = {
            baseUrl: base,
            url: real.url.bind(real),
            fetchJson: async (url: string) => {
                requests.push(url);
                if (status !== 200) throw new HttpError(status);
                return { name: 'Sol Ring' };
            }
        } as unknown as ShopClient;
        const resolver = new ScryfallNameResolver(client, () => now, client);
        const asTyped = { name: 'sol rng', fullName: 'sol rng' };
        expect(await resolver.resolve('sol rng')).toEqual(asTyped);
        expect(await resolver.resolve('sol rng')).toEqual(asTyped);
        expect(
            await Promise.all(resolver.resolveAll(['sol rng', 'daze']))
        ).toEqual([asTyped, { name: 'daze', fullName: 'daze' }]);
        expect(requests).toHaveLength(1);
        expect(logs).toMatchObject([
            {
                level: 'warn',
                message: 'Scryfall rate-limited us, pausing name lookups',
                pause_s: RATE_LIMIT_PAUSE_MS / 1000
            }
        ]);

        status = 200;
        now += RATE_LIMIT_PAUSE_MS;
        expect(await resolver.resolve('sol rng')).toEqual({
            name: 'Sol Ring',
            fullName: 'Sol Ring'
        });
        expect(requests).toHaveLength(2);
    });
});

describe('ScryfallNameResolver for the first cards of a search', () => {
    // a fake per endpoint, recording what each was asked
    function endpoint(answer: (url: string) => unknown) {
        const real = new ShopClient(base);
        const urls: string[] = [];
        const client = {
            baseUrl: base,
            url: real.url.bind(real),
            fetchJson: async (url: string) => {
                urls.push(url);
                return answer(url);
            }
        } as unknown as ShopClient;
        return { client, urls };
    }

    test('a list of 2 is looked up by fuzzy name, without a collection request', async () => {
        const named = endpoint((url) => ({
            name:
                new URL(url).searchParams.get('fuzzy') === 'sol ring'
                    ? 'Sol Ring'
                    : 'Daze'
        }));
        const collection = endpoint(() => ({ data: [] }));
        const resolver = new ScryfallNameResolver(
            named.client,
            undefined,
            collection.client
        );
        expect(
            await Promise.all(resolver.resolveAll(['sol ring', 'daze']))
        ).toEqual([
            { name: 'sol ring', fullName: 'Sol Ring' },
            { name: 'daze', fullName: 'Daze' }
        ]);
        expect(named.urls).toHaveLength(2);
        expect(collection.urls).toEqual([]);
    });

    test('a longer list goes to the collection endpoint, on its own client', async () => {
        const named = endpoint(() => ({ name: 'unused' }));
        const collection = endpoint(() => ({
            data: [{ name: 'Sol Ring' }, { name: 'Daze' }, { name: 'Opt' }]
        }));
        const resolver = new ScryfallNameResolver(
            named.client,
            undefined,
            collection.client
        );
        await Promise.all(resolver.resolveAll(['sol ring', 'daze', 'opt']));
        expect(collection.urls).toEqual([`${base}/cards/collection`]);
        expect(named.urls).toEqual([]);
    });
});
