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
    | 'citadel';

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
    }
};

// Horoshop shops (Nerdik, Kartoteka) answer 403 to some server IPs, e.g. Railway's, but still work in the
// user's browser. So for a blocked search, link the shop's own search page for the user to check by hand.
export function manualSearchUrl(e: SearchError, card: string) {
    const base = e.shop && SHOP_INFO[e.shop].searchUrl;
    return e.status === 403 && base
        ? `${base}?${new URLSearchParams({ q: card })}`
        : null;
}
