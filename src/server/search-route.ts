import { SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api';
import { normalize } from '../matching';
import type { SearchResult, SearchUpdate } from '../search-result';
import type { ShopLimit } from './card-search-service';
import type { InFlightLimiter } from './in-flight-limiter';
import { logger } from './logger';
import type { NameResolver, ResolvedName } from './name-resolver';
import { endSpan, requestContext, tracer } from './tracing';
import { VisitorIds } from './visitor-id';

// The frontend sends its whole list at once, in requests of up to this many cards.
export const MAX_CARDS_PER_REQUEST = 100;

// A long list logs only its first few names; `count` has the rest.
const LOGGED_NAMES = 5;

// The longest card name is 141 characters ("Our Market Research Shows That Players Like Really Long Card Names…").
export const MAX_NAME_LENGTH = 150;
// No card name uses these; they turn up in scanners' injection probes (`{"$ne": null}`, `<machineKey …>`).
const NOT_IN_NAMES = /[{}<>$=]/;

// Whether a name could be a card. Anything else is dropped before it reaches the shops: in a batched API (MTGin,
// Nerdik) a name the shop rejects costs extra requests to isolate (see Batcher).
// `normalize` leaves nothing of a name with nothing searchable ("!!!" would otherwise match every listing).
export function isSearchableName(name: string) {
    return (
        name.length <= MAX_NAME_LENGTH &&
        !NOT_IN_NAMES.test(name) &&
        normalize(name) !== ''
    );
}

type CardSearch = {
    search(
        card: string,
        signal?: AbortSignal,
        onUpdate?: (partial: SearchResult) => void,
        fullName?: string,
        limit?: ShopLimit,
        urgent?: boolean
    ): Promise<SearchResult>;
};

// A request this short is a search's first cards (the frontend sends them ahead of the rest): batched shops send
// them at once rather than waiting for their batch window.
const URGENT_MAX = 2;

// How many cards one client may have at one shop at once, across all its requests; the rest wait their turn.
// A card's shops don't wait on each other: a client's list goes through each shop at that shop's own pace, so a slow
// shop (Kartoteka, CartOn's product pages) doesn't hold back the others. The shop queues are shared by every user,
// so a client's long list takes turns with everyone else's cards instead of filling them.
// Batched shops (see CardSearcher) get a much higher cap: the more of a list they get at once, the fewer requests.
export type ShopLimits = { shops: InFlightLimiter; batched: InFlightLimiter };

// Behind a proxy (Railway) every connection comes from the proxy, so the client is the address the proxy
// appended last to X-Forwarded-For. Earlier entries are whatever the client sent, so they can't be trusted.
// `peer` is the connection's own address, used when there's no proxy.
export function clientId(req: Request, peer: string | undefined) {
    const forwarded = req.headers.get('x-forwarded-for');
    const last = forwarded?.split(',').at(-1)?.trim();
    return last || peer || 'unknown';
}

// POST /api/search {cards: string[]} → NDJSON, one SearchUpdate per line. Each card gets a line every time one of
// its shops finishes, so a slow shop (Kartoteka) doesn't hold back the others; the card's last line has no `pending`.
// Lines come in whatever order the shops finish, so each carries the card's index in `cards`.
// Each card fans out to every shop, through `limits` (see ShopLimits). `req.signal` aborts when the client
// disconnects (closed tab, a new search), which cancels the searches and ends the stream.
// The names go through `names` first, so a misspelled or shortened name ("overlord balemurk") is searched under
// the card's real name; the result's `card` is then that name, and `typed` keeps what was sent.
// A name that can't be a card (see isSearchableName) isn't searched; it gets an empty result at once.
export function searchHandler(
    cardSearch: CardSearch,
    limits: ShopLimits,
    names: NameResolver = {
        resolve: async (card) => ({ name: card, fullName: card })
    },
    visitors = new VisitorIds()
) {
    const respond = async (
        req: Request,
        client: string,
        span: Span
    ): Promise<Response> => {
        const limit: ShopLimit = (searcher, run) =>
            (searcher.batched ? limits.batched : limits.shops).run(
                `${client}\n${searcher.shop}`,
                run,
                req.signal
            );
        const searchCard = async (
            card: string,
            resolved: Promise<ResolvedName>,
            onUpdate: (partial: SearchResult) => void
        ): Promise<SearchResult> => {
            const { name, fullName } = await resolved;
            const withTyped = (result: SearchResult) =>
                name === card ? result : { ...result, typed: card };
            if (name !== card)
                logger.info('name corrected', { typed: card, card: name });
            return withTyped(
                await cardSearch.search(
                    name,
                    req.signal,
                    (partial) => onUpdate(withTyped(partial)),
                    fullName,
                    limit,
                    urgent
                )
            );
        };
        const body = (await req.json().catch(() => null)) as {
            cards?: unknown[];
        } | null;
        // each card keeps its index in the request, which its lines carry
        const sent = (Array.isArray(body?.cards) ? body.cards : []).flatMap(
            (c, index) =>
                typeof c === 'string' ? [{ card: c.trim(), index }] : []
        );
        const skipped = sent.filter((c) => !isSearchableName(c.card));
        const searched = sent.filter((c) => isSearchableName(c.card));
        const cards = searched.map((c) => c.card);
        const urgent = cards.length <= URGENT_MAX;
        logger.info('search', {
            cards: cards.slice(0, LOGGED_NAMES),
            count: cards.length
        });
        span.setAttributes({
            'search.card_count': cards.length,
            'visitor.id': visitors.id(client, req.headers.get('user-agent'))
        });
        if (cards.length > MAX_CARDS_PER_REQUEST) {
            endSpan(span, { status: 400 });
            return Response.json(
                { error: `Too many cards (max ${MAX_CARDS_PER_REQUEST})` },
                { status: 400 }
            );
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                const send = (update: SearchUpdate) => {
                    if (req.signal.aborted) return;
                    try {
                        controller.enqueue(
                            encoder.encode(JSON.stringify(update) + '\n')
                        );
                    } catch {
                        // the client went away mid-write; the abort cancels the rest
                    }
                };
                for (const { card, index } of skipped)
                    send({ index, result: { card, links: [], errors: [] } });
                const resolved = names.resolveAll
                    ? names.resolveAll(cards, req.signal)
                    : cards.map((card) => names.resolve(card, req.signal));
                await Promise.all(
                    searched.map(async ({ card, index }, i) => {
                        try {
                            const result = await searchCard(
                                card,
                                resolved[i]!,
                                (partial) => send({ index, result: partial })
                            );
                            send({ index, result });
                        } catch (err) {
                            if (req.signal.aborted) return;
                            const message = (err as Error).message;
                            // the status line is long gone, so the failure is reported as the card's result
                            logger.error('card search failed', {
                                card,
                                error: err
                            });
                            span.addEvent('card search failed', {
                                card,
                                'exception.message': message
                            });
                            span.setStatus({ code: SpanStatusCode.ERROR });
                            send({
                                index,
                                result: {
                                    card,
                                    links: [],
                                    errors: [{ message }]
                                }
                            });
                        }
                    })
                );
                endSpan(span, { status: 200, signal: req.signal });
                try {
                    controller.close();
                } catch {
                    // already cancelled by the client
                }
            }
        });
        return new Response(stream, {
            headers: {
                'Content-Type': 'application/x-ndjson; charset=utf-8',
                'Cache-Control': 'no-store'
            }
        });
    };

    // The span covers the whole search, so it ends when the stream does (see `start` above), not when the Response
    // is returned: the cards are searched inside the stream, after the status line has gone out. Spans the
    // search starts (name resolution, shop requests) are its children, since the stream starts in its context.
    return (req: Request, client: string): Promise<Response> =>
        tracer.startActiveSpan(
            'POST /api/search',
            {
                kind: SpanKind.SERVER,
                attributes: {
                    'http.request.method': 'POST',
                    'url.path': '/api/search'
                }
            },
            requestContext(req),
            async (span) => {
                try {
                    return await respond(req, client, span);
                } catch (error) {
                    endSpan(span, { error, signal: req.signal });
                    throw error;
                }
            }
        );
}
