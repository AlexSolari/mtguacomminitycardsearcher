import { SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api';
import { normalize } from '../matching';
import type { SearchResult, SearchUpdate } from '../search-result';
import type { InFlightLimiter } from './in-flight-limiter';
import { logger } from './logger';
import type { NameResolver } from './name-resolver';
import { endSpan, tracer } from './tracing';
import { VisitorIds } from './visitor-id';

// The frontend sends one card per request; this only bounds what a hand-made request can queue up.
export const MAX_CARDS_PER_REQUEST = 100;

// A long list logs only its first few names; `count` has the rest.
const LOGGED_NAMES = 5;

type CardSearch = {
    search(
        card: string,
        signal?: AbortSignal,
        onUpdate?: (partial: SearchResult) => void,
        fullName?: string
    ): Promise<SearchResult>;
};

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
// Each card fans out to every shop, so one client's cards go through `limiter` and take turns instead of
// flooding the shop queues. `req.signal` aborts when the client disconnects (closed tab, a new search), which
// cancels the searches and ends the stream.
// Each name goes through `names` first, so a misspelled or shortened name ("overlord balemurk") is searched under
// the card's real name; the result's `card` is then that name, and `typed` keeps what was sent.
export function searchHandler(
    cardSearch: CardSearch,
    limiter: InFlightLimiter,
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
        const searchCard = async (
            card: string,
            onUpdate: (partial: SearchResult) => void
        ): Promise<SearchResult> => {
            const { name, fullName } = await names.resolve(card, req.signal);
            const withTyped = (result: SearchResult) =>
                name === card ? result : { ...result, typed: card };
            if (name !== card)
                logger.info('name corrected', { typed: card, card: name });
            return withTyped(
                await cardSearch.search(
                    name,
                    req.signal,
                    (partial) => onUpdate(withTyped(partial)),
                    fullName
                )
            );
        };
        const body = (await req.json().catch(() => null)) as {
            cards?: unknown[];
        } | null;
        // drop non-strings and names with nothing searchable ("!!!" would otherwise match every listing)
        const cards = (Array.isArray(body?.cards) ? body.cards : [])
            .filter((c): c is string => typeof c === 'string')
            .map((c) => c.trim())
            .filter((c) => normalize(c) !== '');
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
                await Promise.all(
                    cards.map(async (card, index) => {
                        try {
                            const result = await limiter.run(
                                client,
                                () =>
                                    searchCard(card, (partial) =>
                                        send({ index, result: partial })
                                    ),
                                req.signal
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
