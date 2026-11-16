// The links traders submit for their lists, and where each list is read from.

export type ListSource = 'mtggoldfish' | 'manabox';

// A list, identified by its source and the source's own id for it.
export type ListLink = { source: ListSource; ref: string };

const GOLDFISH_DECK = /^\/deck\/(?:(?:arena_)?download\/)?(\d{1,12})\/?$/;
const MANABOX_DECK = /^\/decks\/([\w-]{1,64})\/?$/;

// A pasted link, in the shapes the tools share it:
//   https://www.mtggoldfish.com/deck/6906342#paper   (also /deck/download/…, /deck/arena_download/…, /proxies/new?id=…)
//   https://manabox.app/decks/Qsjv6XwMQ_SynKoo3V-epw
// Anything else is null: other sites, and MTGGoldfish's archetype pages, which are nobody's own list.
export function parseListLink(input: string): ListLink | null {
    let url: URL;
    try {
        url = new URL(input.trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');

    if (host === 'mtggoldfish.com') {
        const id =
            url.pathname.match(GOLDFISH_DECK)?.[1] ??
            (/^\/proxies\/new\/?$/.test(url.pathname)
                ? url.searchParams.get('id')?.match(/^\d{1,12}$/)?.[0]
                : undefined);
        // one deck, however the link spells its number
        return id
            ? { source: 'mtggoldfish', ref: id.replace(/^0+(?=\d)/, '') }
            : null;
    }
    if (host === 'manabox.app') {
        const id = url.pathname.match(MANABOX_DECK)?.[1];
        return id ? { source: 'manabox', ref: id } : null;
    }
    return null;
}

// Where a list is fetched from. MTGGoldfish's deck pages are behind a Cloudflare challenge, so its list is read
// from the proxy printer, which is prefilled with the deck and isn't (see parsers/mtggoldfish.ts).
export const LIST_SOURCES: Record<
    ListSource,
    {
        label: string;
        base: string; // the source's ShopClient base URL
        page: (ref: string) => {
            path: string;
            params?: Record<string, string>;
        };
        link: (ref: string) => string; // the list as people open it, for the owner and the offers
    }
> = {
    mtggoldfish: {
        label: 'MTGGoldfish',
        base: 'https://www.mtggoldfish.com',
        page: (ref) => ({ path: '/proxies/new', params: { id: ref } }),
        link: (ref) => `https://www.mtggoldfish.com/deck/${ref}`
    },
    manabox: {
        label: 'ManaBox',
        base: 'https://manabox.app',
        page: (ref) => ({ path: `/decks/${ref}` }),
        link: (ref) => `https://manabox.app/decks/${ref}`
    }
};
