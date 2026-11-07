import { languageCode, SHOP_INFO, type CardResult } from '../../shops';

const CONDITIONS: Record<string, string> = {
    mint: 'M',
    near_mint: 'NM',
    excellent: 'EX',
    lightly_played: 'LP',
    good: 'GD',
    moderately_played: 'MP',
    played: 'PL',
    heavily_played: 'HP',
    poor: 'PO',
    damaged: 'DMG'
};

// paytowin.club — card auctions, via the site's public JSON API (api.paytowin.club/auctions?q=…&game=magic).
// Titles are free text written by sellers ("Raucous Theater #266", "4х Viper"); photos are the seller's own.
export function parsePaytowin(json: any): CardResult[] {
    const items: any[] = json?.items ?? [];
    return items
        .filter((a) => a.status === 'live')
        .map((a) => {
            const currentBid =
                typeof a.current_high_uah === 'number'
                    ? a.current_high_uah
                    : null;
            return {
                shop: 'paytowin' as const,
                name: String(a.title ?? '').trim(),
                // the API host isn't the site: lots live at paytowin.club/a/<id>
                url: `${SHOP_INFO.paytowin.homepage}/a/${a.id}`,
                image:
                    a.photos?.[0]?.urls?.medium ??
                    a.photos?.[0]?.urls?.thumb ??
                    null,
                price: currentBid ?? a.starting_price_uah ?? null,
                foil: a.foil === true || undefined,
                language: languageCode(a.language),
                condition: CONDITIONS[a.condition as string],
                auction: {
                    currentBid,
                    startingPrice: a.starting_price_uah,
                    buyNow:
                        typeof a.buy_now_uah === 'number'
                            ? a.buy_now_uah
                            : null,
                    endsAt: a.end_time,
                    bids: a.bid_count ?? 0
                }
            };
        });
}
