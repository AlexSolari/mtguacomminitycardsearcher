import { describe, expect, test } from 'bun:test';
import { LIST_SOURCES, parseListLink } from '@/server/lists/list-link';

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
        'https://moxfield.com/decks/abc'
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

    // every source's page must be on its client's host, which ShopClient enforces
    test('pages and links are on the source host', () => {
        for (const source of Object.values(LIST_SOURCES)) {
            const host = new URL(source.base).hostname;
            expect(new URL(source.page('1').path, source.base).hostname).toBe(
                host
            );
            expect(new URL(source.link('1')).hostname).toBe(host);
        }
    });
});
