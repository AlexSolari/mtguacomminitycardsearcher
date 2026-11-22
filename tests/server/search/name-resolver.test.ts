import { describe, expect, test } from 'bun:test';
import {
    RATE_LIMIT_PAUSE_MS,
    ScryfallNameResolver
} from '@/server/search/name-resolver';
import { CardIndex } from '@/server/search/card-index';
import { ShopUnavailableError } from '@/server/outbound/circuit-breaker';
import {
    HttpError,
    RequestTimeoutError,
    ShopClient
} from '@/server/outbound/shop-client';
import { captureLogs } from '../capture-logs';

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

const index = new CardIndex([
    'Overlord of the Balemurk',
    [
        'Delver of Secrets // Insectile Aberration',
        'Delver of Secrets',
        'Insectile Aberration'
    ]
]);

describe('ScryfallNameResolver', () => {
    test('corrects a partial name to the card name', async () => {
        const { client, requests } = fakeScryfall(() => ({
            name: 'Overlord of the Balemurk'
        }));
        const resolver = new ScryfallNameResolver(client);
        expect(await resolver.resolve('overlord balemurk')).toEqual({
            name: 'Overlord of the Balemurk',
            fullName: 'Overlord of the Balemurk',
            foundBy: 'scryfall'
        });
        expect(requests[0]!.fuzzy).toBe('overlord balemurk');
        expect(requests[0]!.init?.headers).toMatchObject({
            Accept: 'application/json'
        });
    });

    test('a name the index knows costs no request', async () => {
        const { client, requests } = fakeScryfall(() => new HttpError(500));
        const resolver = new ScryfallNameResolver(
            client,
            undefined,
            client,
            index
        );
        expect(await resolver.resolve('overlord balemurk')).toEqual({
            name: 'Overlord of the Balemurk',
            fullName: 'Overlord of the Balemurk',
            foundBy: 'index'
        });
        // the face typed, as with Scryfall's answer
        expect(await resolver.resolve('insectile aberration')).toEqual({
            name: 'insectile aberration',
            fullName: 'Delver of Secrets // Insectile Aberration',
            foundBy: 'index'
        });
        expect(requests).toEqual([]);
    });

    test('a name the index can’t place is asked of Scryfall', async () => {
        const { client, requests } = fakeScryfall(() => ({ name: 'Daze' }));
        const resolver = new ScryfallNameResolver(
            client,
            undefined,
            client,
            index
        );
        expect(await resolver.resolve('dazee')).toEqual({
            name: 'Daze',
            fullName: 'Daze',
            foundBy: 'scryfall'
        });
        expect(requests.map((r) => r.fuzzy)).toEqual(['dazee']);
    });

    test('keeps the typed name when it already is the card', async () => {
        const { client } = fakeScryfall(() => ({ name: 'Æther Vial' }));
        const resolver = new ScryfallNameResolver(client);
        expect(await resolver.resolve('aether vial')).toEqual({
            name: 'aether vial',
            fullName: 'Æther Vial',
            foundBy: 'scryfall'
        });
    });

    test('a cached name answers each search as it typed the name, not as the first one did', async () => {
        const { client, requests } = fakeScryfall(() => ({
            name: 'Aether Vial'
        }));
        const resolver = new ScryfallNameResolver(client);
        expect(await resolver.resolve('aether vial')).toEqual({
            name: 'aether vial',
            fullName: 'Aether Vial',
            foundBy: 'scryfall'
        });
        expect(await resolver.resolve('Aether Vial')).toEqual({
            name: 'Aether Vial',
            fullName: 'Aether Vial',
            foundBy: 'scryfall'
        });
        expect(requests).toHaveLength(1);
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
            fullName: delver.name,
            foundBy: 'scryfall'
        });
        expect(await resolver.resolve('Insectile Aberration')).toEqual({
            name: 'Insectile Aberration',
            fullName: delver.name,
            foundBy: 'scryfall'
        });
    });

    test('an unknown or ambiguous name (404) is searched as typed, and remembered', async () => {
        const { client, requests } = fakeScryfall(() => new HttpError(404));
        const resolver = new ScryfallNameResolver(client);
        expect(await resolver.resolve('Сол Рінг')).toEqual({
            name: 'Сол Рінг',
            fullName: 'Сол Рінг'
        });
        // remembered as not found, so each search keeps its own typing
        expect(await resolver.resolve('сол рінг')).toEqual({
            name: 'сол рінг',
            fullName: 'сол рінг'
        });
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

    test('while Scryfall is found down, names are searched as typed without a warning each', async () => {
        const { client, requests } = fakeScryfall(
            () => new ShopUnavailableError()
        );
        const resolver = new ScryfallNameResolver(client);
        expect(await resolver.resolve('Sol Ring')).toEqual({
            name: 'Sol Ring',
            fullName: 'Sol Ring'
        });
        await resolver.resolve('Sol Ring');
        expect(requests).toHaveLength(2); // not cached: the next search tries again
        expect(logs).toEqual([]);
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
        collectionFails?: Error | ((names: string[]) => Error | undefined)
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
                    const failure =
                        typeof collectionFails === 'function'
                            ? collectionFails(names)
                            : collectionFails;
                    if (failure) throw failure;
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
            { name: 'sol ring', fullName: 'Sol Ring', foundBy: 'scryfall' },
            {
                name: 'Insectile Aberration',
                fullName: delver.name,
                foundBy: 'scryfall'
            },
            {
                name: 'Overlord of the Balemurk',
                fullName: 'Overlord of the Balemurk',
                foundBy: 'scryfall'
            }
        ]);
        expect(calls.collection).toEqual([
            ['sol ring', 'Insectile Aberration', 'overlord balemurk']
        ]);
        expect(calls.fuzzy).toEqual(['overlord balemurk']);
    });

    test('asks Scryfall only for the names the index can’t place', async () => {
        const { client, calls } = fakeCollection(() => ({ name: 'Daze' }));
        const resolver = new ScryfallNameResolver(
            client,
            undefined,
            client,
            index
        );
        const names = await Promise.all(
            resolver.resolveAll([
                'overlord balemurk',
                'sol ring',
                'Insectile Aberration',
                'opt',
                'dazee'
            ])
        );
        expect(names).toEqual([
            {
                name: 'Overlord of the Balemurk',
                fullName: 'Overlord of the Balemurk',
                foundBy: 'index'
            },
            { name: 'sol ring', fullName: 'Sol Ring', foundBy: 'scryfall' },
            {
                name: 'Insectile Aberration',
                fullName: delver.name,
                foundBy: 'index'
            },
            { name: 'opt', fullName: 'Opt', foundBy: 'scryfall' },
            { name: 'Daze', fullName: 'Daze', foundBy: 'scryfall' }
        ]);
        expect(calls.collection).toEqual([['sol ring', 'opt', 'dazee']]);
        expect(calls.fuzzy).toEqual(['dazee']);
    });

    test('a list the index knows all of costs no request', async () => {
        const { client, calls } = fakeCollection();
        const resolver = new ScryfallNameResolver(
            client,
            undefined,
            client,
            index
        );
        await Promise.all(
            resolver.resolveAll([
                'overlord balemurk',
                'delver secrets',
                'Insectile Aberration'
            ])
        );
        expect(calls).toEqual({ collection: [], fuzzy: [] });
    });

    test('remembers what it found, and asks once per name', async () => {
        const { client, calls } = fakeCollection();
        const resolver = new ScryfallNameResolver(client, undefined, client);
        const first = await Promise.all(
            resolver.resolveAll(['Sol Ring', 'sol ring', 'Daze', 'Opt'])
        );
        // each as typed, though both share one lookup and one cache entry
        expect(first.map((r) => r.name)).toEqual([
            'Sol Ring',
            'sol ring',
            'Daze',
            'Opt'
        ]);
        expect(await Promise.all(resolver.resolveAll(['SOL RING']))).toEqual([
            { name: 'SOL RING', fullName: 'Sol Ring', foundBy: 'scryfall' }
        ]);
        expect(calls.collection).toEqual([['Sol Ring', 'Daze', 'Opt']]);
        expect(await resolver.resolve('sol ring')).toEqual({
            name: 'sol ring',
            fullName: 'Sol Ring',
            foundBy: 'scryfall'
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
        ).toEqual({
            name: 'sol ring',
            fullName: 'Sol Ring',
            foundBy: 'scryfall'
        });
        expect(calls.fuzzy).toEqual(['sol ring', 'x', 'y']);
        expect(calls.collection).toHaveLength(2); // a 503 is retried once
        expect(logs[0]).toMatchObject({
            level: 'warn',
            message: 'bulk name lookup failed, looking names up one by one',
            count: 3
        });
    });

    test('a rejected request is split until the name Scryfall refuses is alone', async () => {
        const { client, calls } = fakeCollection(undefined, (names) =>
            names.includes('bad') ? new HttpError(422) : undefined
        );
        const resolver = new ScryfallNameResolver(client, undefined, client);
        await Promise.all(
            resolver.resolveAll(['sol ring', 'daze', 'opt', 'bad'])
        );
        expect(calls.collection).toEqual([
            ['sol ring', 'daze', 'opt', 'bad'],
            ['sol ring', 'daze'],
            ['opt', 'bad'],
            ['opt'],
            ['bad']
        ]);
        expect(calls.fuzzy).toEqual(['bad']);
        expect(logs).toMatchObject([
            {
                level: 'warn',
                message: 'bulk name lookup failed, looking names up one by one',
                count: 1
            },
            { message: 'bulk name lookup missed names', count: 4, missed: 1 }
        ]);
    });

    test('splitting stops after 16 more requests when Scryfall refuses every name', async () => {
        const { client, calls } = fakeCollection(undefined, new HttpError(400));
        const resolver = new ScryfallNameResolver(client, undefined, client);
        const cards = Array.from({ length: 75 }, (_, i) => `Card ${i}`);
        await Promise.all(resolver.resolveAll(cards));
        expect(calls.collection).toHaveLength(17);
        expect(calls.fuzzy).toHaveLength(75);
    });

    test('a timeout is retried once, and found names need no single lookups', async () => {
        let failures = 1;
        const { client, calls } = fakeCollection(undefined, () =>
            failures-- > 0
                ? new RequestTimeoutError('timeout after 15s')
                : undefined
        );
        const resolver = new ScryfallNameResolver(client, undefined, client);
        await Promise.all(resolver.resolveAll(['sol ring', 'daze', 'opt']));
        expect(calls.collection).toHaveLength(2);
        expect(calls.fuzzy).toEqual([]);
        expect(logs).toEqual([]);
    });

    test('names the bulk lookup misses are counted in the log', async () => {
        const { client } = fakeCollection();
        const resolver = new ScryfallNameResolver(client, undefined, client);
        await Promise.all(resolver.resolveAll(['sol ring', 'Сол Ринг', 'Опт']));
        expect(logs).toMatchObject([
            {
                level: 'info',
                message: 'bulk name lookup missed names',
                count: 3,
                missed: 2
            }
        ]);
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
            fullName: 'Sol Ring',
            foundBy: 'scryfall'
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
            { name: 'sol ring', fullName: 'Sol Ring', foundBy: 'scryfall' },
            { name: 'daze', fullName: 'Daze', foundBy: 'scryfall' }
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
