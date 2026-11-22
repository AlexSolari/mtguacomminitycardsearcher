import type { ListRefreshError } from '@/shared/account';
import { logger } from '@/server/observability/logger';
import { HttpError, ShopClient } from '@/server/outbound/shop-client';
import type { ParsedList } from '@/server/lists/list-card';
import {
    LIST_SOURCES,
    type ListLink,
    type ListSource
} from '@/server/lists/list-link';
import { parseManabox } from '@/server/lists/parsers/manabox';
import { parseMoxfield } from '@/server/lists/parsers/moxfield';
import { parseMtggoldfish } from '@/server/lists/parsers/mtggoldfish';

// Rows a list may have. A trader's whole collection can run to thousands; past this, the owner is asked to split it.
// Each 75 rows without a price cost one Scryfall request (see list-prices.ts).
export const MAX_LIST_ROWS = 2000;

// A list is read once a day, so its source gets one request every few seconds at most, however many lists are due.
const SOURCE_INTERVAL_MS = 5_000;

// Each parser takes the page's body: HTML for MTGGoldfish and ManaBox, JSON for Moxfield.
const PARSERS: Record<ListSource, (body: string) => ParsedList | null> = {
    mtggoldfish: parseMtggoldfish,
    manabox: parseManabox,
    moxfield: parseMoxfield
};

// A refresh that failed, with the reason the owner sees (MyList.lastError).
export class ListRefreshFailure extends Error {
    constructor(
        readonly reason: ListRefreshError,
        options?: { cause?: unknown }
    ) {
        super(reason, options);
    }
}

// Reads a list from its source: one page, through the source's own ShopClient (its rate limit, timeout and circuit
// breaker), parsed by the source's parser.
export class ListReader {
    constructor(
        private readonly clients: Record<ListSource, ShopClient> = {
            mtggoldfish: sourceClient('mtggoldfish'),
            manabox: sourceClient('manabox'),
            moxfield: sourceClient('moxfield')
        }
    ) {}

    async read(link: ListLink, signal?: AbortSignal): Promise<ParsedList> {
        const client = this.clients[link.source];
        const { page, headers } = LIST_SOURCES[link.source];
        const { path, params } = page(link.ref);
        const url = client.url(path, params);
        let html: string;
        try {
            html = await client.fetchHtml(url, { signal, headers });
        } catch (err) {
            throw new ListRefreshFailure(
                err instanceof HttpError && err.status === 404
                    ? 'not-found'
                    : 'unavailable',
                { cause: err }
            );
        }
        const list = PARSERS[link.source](html);
        // what a source redesign looks like: the page came, the list wasn't where the parser looks
        if (!list) {
            logger.warn('list parser found nothing', {
                source: link.source,
                url
            });
            throw new ListRefreshFailure('unreadable');
        }
        if (list.cards.length > MAX_LIST_ROWS)
            throw new ListRefreshFailure('too-large');
        return list;
    }
}

function sourceClient(source: ListSource) {
    return new ShopClient(LIST_SOURCES[source].base, {
        intervalMs: SOURCE_INTERVAL_MS,
        timeoutMs: 20_000
    });
}
