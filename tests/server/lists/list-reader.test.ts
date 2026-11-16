import { describe, expect, test } from 'bun:test';
import {
    ListReader,
    ListRefreshFailure,
    MAX_LIST_ROWS
} from '@/server/lists/list-reader';
import type { ListSource } from '@/server/lists/list-link';
import { HttpError, ShopClient } from '@/server/shop-client';
import { captureLogs } from '../capture-logs';
import { html } from '../parsers/parser-fixtures';

const logs = captureLogs();

// Clients that answer every page with `answer` (or throw it), recording the URLs asked for.
function reader(answer: () => Promise<string> | string) {
    const urls: string[] = [];
    const client = (base: string) => {
        const real = new ShopClient(base);
        return {
            baseUrl: base,
            url: real.url.bind(real),
            fetchHtml: async (url: string) => {
                urls.push(url);
                return answer();
            }
        } as unknown as ShopClient;
    };
    return {
        reader: new ListReader({
            mtggoldfish: client('https://www.mtggoldfish.com'),
            manabox: client('https://manabox.app')
        }),
        urls
    };
}

const failure = (promise: Promise<unknown>) =>
    promise.then(
        () => {
            throw new Error('expected a failure');
        },
        (err) => {
            expect(err).toBeInstanceOf(ListRefreshFailure);
            return (err as ListRefreshFailure).reason;
        }
    );

const goldfishPage = (lines: string[]) =>
    `<textarea name="deck" id="deck">${lines.join('\n')}</textarea>`;

describe('ListReader', () => {
    test("reads MTGGoldfish lists from the proxy printer, and ManaBox's from the deck page", async () => {
        const pages: Record<ListSource, string> = {
            mtggoldfish: await html('mtggoldfish-proxies.html'),
            manabox: await html('manabox-deck.html')
        };
        let source: ListSource = 'mtggoldfish';
        const { reader: r, urls } = reader(() => pages[source]);
        const goldfish = await r.read({
            source: 'mtggoldfish',
            ref: '6906342'
        });
        expect(goldfish.cards.length).toBeGreaterThan(10);
        source = 'manabox';
        const manabox = await r.read({ source: 'manabox', ref: 'abc' });
        expect(manabox.title).toBeString();
        expect(manabox.cards[0]?.usd).toBeNumber();
        expect(urls).toEqual([
            'https://www.mtggoldfish.com/proxies/new?id=6906342',
            'https://manabox.app/decks/abc'
        ]);
    });

    test('a 404 is a list that no longer exists; any other failure, a source not answering', async () => {
        const link = { source: 'manabox', ref: 'gone' } as const;
        expect(
            await failure(
                reader(() => {
                    throw new HttpError(404);
                }).reader.read(link)
            )
        ).toBe('not-found');
        expect(
            await failure(
                reader(() => {
                    throw new HttpError(503);
                }).reader.read(link)
            )
        ).toBe('unavailable');
    });

    test('a page without the list is a redesign: unreadable, and logged', async () => {
        logs.length = 0;
        const { reader: r } = reader(() => '<html>Just a moment…</html>');
        expect(await failure(r.read({ source: 'mtggoldfish', ref: '1' }))).toBe(
            'unreadable'
        );
        expect(logs).toMatchObject([
            {
                level: 'warn',
                message: 'list parser found nothing',
                source: 'mtggoldfish',
                url: 'https://www.mtggoldfish.com/proxies/new?id=1'
            }
        ]);
    });

    test(`a list may have ${MAX_LIST_ROWS} rows`, async () => {
        const rows = (n: number) =>
            Array.from({ length: n }, (_, i) => `1 Card ${i}`);
        const link = { source: 'mtggoldfish', ref: '1' } as const;
        expect(
            (
                await reader(() =>
                    goldfishPage(rows(MAX_LIST_ROWS))
                ).reader.read(link)
            ).cards
        ).toHaveLength(MAX_LIST_ROWS);
        expect(
            await failure(
                reader(() => goldfishPage(rows(MAX_LIST_ROWS + 1))).reader.read(
                    link
                )
            )
        ).toBe('too-large');
    });

    test('by default each source has its own client', () => {
        expect(() => new ListReader()).not.toThrow();
    });
});
