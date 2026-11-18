import { describe, expect, test } from 'bun:test';
import {
    findListLinks,
    LIST_SOURCES,
    parseListLink
} from '@/server/lists/list-link';

describe('parseListLink', () => {
    test.each([
        'https://www.mtggoldfish.com/deck/6906342',
        'https://www.mtggoldfish.com/deck/6906342#paper',
        'https://mtggoldfish.com/deck/6906342/',
        'http://www.mtggoldfish.com/deck/download/6906342',
        'https://www.mtggoldfish.com/deck/arena_download/6906342',
        'https://www.mtggoldfish.com/proxies/new?id=6906342',
        '  https://WWW.MTGGoldfish.com/deck/006906342  '
    ])('MTGGoldfish deck: %s', (link) => {
        expect(parseListLink(link)).toEqual({
            source: 'mtggoldfish',
            ref: '6906342'
        });
    });

    test.each([
        'https://manabox.app/decks/Qsjv6XwMQ_SynKoo3V-epw',
        'https://www.manabox.app/decks/Qsjv6XwMQ_SynKoo3V-epw/',
        'https://manabox.app/decks/Qsjv6XwMQ_SynKoo3V-epw?ref=share#top'
    ])('ManaBox deck: %s', (link) => {
        expect(parseListLink(link)).toEqual({
            source: 'manabox',
            ref: 'Qsjv6XwMQ_SynKoo3V-epw'
        });
    });

    test.each([
        'https://moxfield.com/decks/oEWXWHM5eEGMmopExLWRCA',
        'https://www.moxfield.com/decks/oEWXWHM5eEGMmopExLWRCA/',
        'https://moxfield.com/decks/oEWXWHM5eEGMmopExLWRCA/primer',
        'https://moxfield.com/decks/oEWXWHM5eEGMmopExLWRCA?tab=stats#x'
    ])('Moxfield deck: %s', (link) => {
        expect(parseListLink(link)).toEqual({
            source: 'moxfield',
            ref: 'oEWXWHM5eEGMmopExLWRCA'
        });
    });

    test.each([
        '',
        'Sol Ring',
        'mtggoldfish.com/deck/6906342', // no scheme: not a link we can read
        'ftp://www.mtggoldfish.com/deck/6906342',
        'https://www.mtggoldfish.com/archetype/modern-living-end',
        'https://www.mtggoldfish.com/deck/abc',
        'https://www.mtggoldfish.com/deck/6906342/edit',
        'https://www.mtggoldfish.com/proxies/new',
        'https://www.mtggoldfish.com/proxies/new?id=12x',
        'https://www.mtggoldfish.com/deck/1234567890123',
        'https://mtggoldfish.com.evil.example/deck/6906342',
        'https://manabox.app/decks/',
        'https://manabox.app/decks/a/b',
        'https://manabox.app/guides/decks/faq',
        'https://moxfield.com/decks/abc',
        'https://moxfield.com/decks/public',
        'https://moxfield.com/decks/personal',
        'https://moxfield.com/decks/oEWXWHM5eEGMmopExLWRCA/a/b',
        'https://moxfield.com/users/someone',
        'https://api2.moxfield.com/v3/decks/all/oEWXWHM5eEGMmopExLWRCA'
    ])('not a list: %p', (link) => {
        expect(parseListLink(link)).toBeNull();
    });
});

describe('LIST_SOURCES', () => {
    test('MTGGoldfish is read from the proxy printer, linked to the deck page', () => {
        const goldfish = LIST_SOURCES.mtggoldfish;
        expect(goldfish.page('6906342')).toEqual({
            path: '/proxies/new',
            params: { id: '6906342' }
        });
        expect(goldfish.link('6906342')).toBe(
            'https://www.mtggoldfish.com/deck/6906342'
        );
    });

    test('ManaBox is read from and linked to the shared deck', () => {
        const manabox = LIST_SOURCES.manabox;
        expect(manabox.page('abc_D-1')).toEqual({ path: '/decks/abc_D-1' });
        expect(manabox.link('abc_D-1')).toBe(
            'https://manabox.app/decks/abc_D-1'
        );
    });

    test("Moxfield is read from its API, with the stopgap User-Agent, and linked to the deck's page", () => {
        const moxfield = LIST_SOURCES.moxfield;
        expect(moxfield.page('abc_D-1')).toEqual({
            path: '/v3/decks/all/abc_D-1'
        });
        expect(moxfield.link('abc_D-1')).toBe(
            'https://moxfield.com/decks/abc_D-1'
        );
        expect(moxfield.headers).toEqual({
            'User-Agent': 'PostmanRuntime/7.31.1'
        });
    });

    // every source's page must be on its client's host, which ShopClient enforces; the link is on the same site
    // (Moxfield's API is a subdomain of the site people open)
    test('pages and links are on the source host', () => {
        for (const source of Object.values(LIST_SOURCES)) {
            const host = new URL(source.base).hostname;
            expect(new URL(source.page('1').path, source.base).hostname).toBe(
                host
            );
            const site = new URL(source.link('1')).hostname;
            expect(host === site || host.endsWith(`.${site}`)).toBe(true);
        }
    });
});

describe('findListLinks', () => {
    // a trader's post, the way they share their lists in Telegram groups
    const POST = `#Продажа курс 40, Киев (МВ) или доставка НП, карты в ЕДХ, пионер, модерн и стандарт, в сайде фойл.
https://www.mtggoldfish.com/deck/2813365#paper
https://www.mtggoldfish.com/deck/5190327#paper
🎃🎃🎃 Список, состоящий из отличных карт во все форматы
https://www.mtggoldfish.com/deck/7217240#paper

💥💥💥Список с МАНАБАЗОЙ (шокленды, вержи, сурвейленды, фастленды)
https://www.mtggoldfish.com/deck/7911381#paper💥💥💥

💣💣💣 REALITY FRACTURE!!! https://www.mtggoldfish.com/deck/7972707#paper 💣💣💣
Последнее обновление списков: 18.11.2026`;

    test('finds every list in a post, in order, emoji and text around them', () => {
        expect(findListLinks(POST)).toEqual(
            ['2813365', '5190327', '7217240', '7911381', '7972707'].map(
                (ref) => ({ source: 'mtggoldfish', ref })
            )
        );
    });

    test('mixes sources, drops repeats and links that are no list, and trims punctuation', () => {
        expect(
            findListLinks(
                `Moxfield (https://moxfield.com/decks/oEWXWHM5eEGMmopExLWRCA), ManaBox: https://manabox.app/decks/Qsjv6XwMQ_SynKoo3V-epw.
                 again https://www.mtggoldfish.com/deck/006906342, https://mtggoldfish.com/deck/6906342!
                 <https://t.me/somechannel> https://www.mtggoldfish.com/archetype/modern-boros`
            )
        ).toEqual([
            { source: 'moxfield', ref: 'oEWXWHM5eEGMmopExLWRCA' },
            { source: 'manabox', ref: 'Qsjv6XwMQ_SynKoo3V-epw' },
            { source: 'mtggoldfish', ref: '6906342' }
        ]);
    });

    test('a single link is a message with one list; text without lists has none', () => {
        expect(
            findListLinks(' https://www.mtggoldfish.com/deck/1#paper ')
        ).toEqual([{ source: 'mtggoldfish', ref: '1' }]);
        expect(findListLinks('Продам карти, пишіть в особисті')).toEqual([]);
        expect(findListLinks('')).toEqual([]);
    });
});
