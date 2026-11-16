// The shop registry. Shared between server and frontend — keep free of server-only imports.
import type { SearchError } from './search-result';

export type ShopId =
    | 'gin'
    | 'carton'
    | 'manavault'
    | 'nerdik'
    | 'kartoteka'
    | 'paytowin'
    | 'magicswamp'
    | 'citadel'
    | 'traders'; // traders' own lists (server/searchers/trader-list-searcher.ts), not a shop

// lucide's "users" icon, grey so it reads in both themes (an <img> can't take the text colour)
const TRADERS_ICON = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8b8b95" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
)}`;

export const SHOP_INFO: Record<
    ShopId,
    {
        label: string;
        homepage: string;
        icon: string;
        searchUrl?: string; // search page taking `?q=<card>`, linked for manual checks when our search is blocked
    }
> = {
    gin: {
        label: 'MTGin',
        homepage: 'https://mtgin.kyiv.ua',
        icon: 'https://mtgin.kyiv.ua/favicon.png'
    },
    carton: {
        label: 'CartOn',
        homepage: 'https://carton.cards',
        icon: 'https://carton.cards/icon.png'
    },
    manavault: {
        label: 'Mana Vault',
        homepage: 'https://manavaultstore.com',
        icon: 'https://manavaultstore.com/favicon.ico'
    },
    nerdik: {
        label: 'Nerdik',
        homepage: 'https://nerdik.club',
        icon: 'https://nerdik.club/assets/favicon.ico',
        searchUrl: 'https://nerdik.club/katalog/search/'
    },
    kartoteka: {
        label: 'Kartoteka',
        homepage: 'https://kartoteka.in.ua',
        icon: 'https://kartoteka.in.ua/assets/favicon.ico',
        searchUrl: 'https://kartoteka.in.ua/ua/search/'
    },
    paytowin: {
        label: 'PayToWin',
        homepage: 'https://paytowin.club',
        icon: 'https://paytowin.club/favicon-96x96.png'
    },
    magicswamp: {
        label: 'Magic Swamp',
        homepage: 'https://magicswamp.com.ua/mtg',
        icon: 'https://magicswamp.com.ua/images/froggowizard-flat.png?v=2'
    },
    citadel: {
        label: 'Citadel',
        homepage: 'https://citadel.kyiv.ua',
        icon: 'https://citadel.kyiv.ua/citadelTower3.svg'
    },
    traders: {
        label: 'Гравці',
        homepage: '/lists',
        icon: TRADERS_ICON
    }
};

// The shops proper, without the traders' lists: what the header names as the shops compared.
export const SHOP_IDS = (Object.keys(SHOP_INFO) as ShopId[]).filter(
    (shop) => shop !== 'traders'
);

// Horoshop shops (Nerdik, Kartoteka) answer 403 to some server IPs, e.g. Railway's, but still work in the
// user's browser. So for a blocked search, link the shop's own search page for the user to check by hand.
export function manualSearchUrl(e: SearchError, card: string) {
    const base = e.shop && SHOP_INFO[e.shop].searchUrl;
    return e.status === 403 && base
        ? `${base}?${new URLSearchParams({ q: card })}`
        : null;
}
