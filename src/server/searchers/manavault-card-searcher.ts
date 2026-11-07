import { parseManavault, parseManavaultVersions } from '../parsers/manavault';
import { isExactMatch } from '../../matching';
import type { CardResult } from '../../search-result';
import { warnFallback, warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

// Mana Vault's search returns one tile per card. For exact matches, swap it for the card's versions page, which
// lists every in-stock printing with its own price. That page wants the exact, case-sensitive full name
// ("Daze", "Emeritus of Woe // Demonic Tutor"), so we take names from the search results. Only when none of them
// match exactly do we try the query as typed — otherwise it's an extra request that usually 404s ("sol ring").
export class ManavaultCardSearcher implements CardSearcher {
    readonly shop = 'manavault';

    constructor(
        private readonly client = new ShopClient('https://manavaultstore.com')
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        const base = this.client.baseUrl;
        const searchUrl = this.client.url('/cards', {
            q: card
        });
        const found = warnIfEmpty(
            this.shop,
            searchUrl,
            parseManavault(
                await this.client.fetchHtml(searchUrl, { signal }),
                base
            )
        );
        const exact = found.filter((l) => isExactMatch(l.name, card));
        const names =
            exact.length > 0 ? [...new Set(exact.map((l) => l.name))] : [card];

        const versions = await Promise.all(
            names.map((name) => {
                const url = this.client.url('/cards/versions', { name });
                return this.client
                    .fetchHtml(url, { signal })
                    .then((html) =>
                        warnIfEmpty(
                            this.shop,
                            url,
                            parseManavaultVersions(html, base)
                        )
                    )
                    .catch((err) => {
                        // 404 = no card by that exact name
                        warnFallback(this.shop, url, err, signal, {
                            expect404: true
                        });
                        return null;
                    });
            })
        );
        const printings = versions.flatMap((v) => v ?? []);
        if (printings.length === 0) return found; // versions lookup failed / nothing in stock there — keep search results

        // a name whose versions lookup failed keeps its search tile, so one failure doesn't drop the card
        const failed = new Set(names.filter((_, i) => versions[i] === null));
        const byUrl = new Map(printings.map((p) => [p.url, p]));
        for (const l of found)
            if (!isExactMatch(l.name, card) || failed.has(l.name))
                byUrl.set(l.url, l); // keep fuzzy "other matches"
        return [...byUrl.values()];
    }
}
