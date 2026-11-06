import type { CardResult, ShopId } from '../shops';

// Searches one shop for a card. Implementations get the shared ShopClient so requests to their shop are rate-limited.
export interface CardSearcher {
    readonly shop: ShopId;
    search(card: string): Promise<CardResult[]>;
}

export const withQuery = (url: string, params: Record<string, string>) =>
    `${url}?${new URLSearchParams(params)}`;
