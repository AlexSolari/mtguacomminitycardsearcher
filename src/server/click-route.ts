import { SpanKind, type Attributes } from '@opentelemetry/api';
import type { OfferClick, OfferGroup } from '../search-result';
import { SHOP_INFO, type ShopId } from '../shops';
import { requestContext, tracer } from './tracing';
import type { VisitorIds } from './visitor-id';

// A click is a few short fields; anything bigger isn't from our frontend.
export const MAX_CLICK_BYTES = 1024;
const MAX_CARD_LENGTH = 200;

const GROUPS = new Set<OfferGroup>([
    'exact',
    'auctions',
    'other',
    'art',
    'manual'
]);
const VIEWS = new Set<OfferClick['view']>(['grid', 'table']);

// The click, if every field is what the frontend sends; otherwise null.
export function parseClick(text: string): OfferClick | null {
    let body: Partial<Record<keyof OfferClick, unknown>> | null;
    try {
        body = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof body !== 'object' || body === null) return null;
    const { shop, card, group, view, best, price } = body;
    const valid =
        typeof shop === 'string' &&
        Object.hasOwn(SHOP_INFO, shop) &&
        typeof card === 'string' &&
        card.trim() !== '' &&
        card.length <= MAX_CARD_LENGTH &&
        GROUPS.has(group as OfferGroup) &&
        VIEWS.has(view as OfferClick['view']) &&
        typeof best === 'boolean' &&
        (price === null ||
            (typeof price === 'number' && Number.isFinite(price)));
    return valid
        ? {
              shop: shop as ShopId,
              card: card.trim(),
              group: group as OfferGroup,
              view: view as OfferClick['view'],
              best,
              price: price as number | null
          }
        : null;
}

// POST /api/click {OfferClick} → 204, sent by the frontend (sendBeacon) when someone opens an offer. Each click is
// one `offer click` span, so the dashboard can break clicks down by shop, card, group and view, and count distinct
// `visitor.id`s per day. It's only recorded as a span: with tracing off, clicks go nowhere.
// Anyone can post here, so the numbers can be inflated by hand; nothing else depends on them.
export function clickHandler(visitors: VisitorIds) {
    return async (req: Request, client: string): Promise<Response> => {
        const length = Number(req.headers.get('content-length') ?? 0);
        const text =
            length > MAX_CLICK_BYTES ? '' : await req.text().catch(() => '');
        const click = text.length > MAX_CLICK_BYTES ? null : parseClick(text);
        if (!click) return new Response(null, { status: 400 });

        const attributes: Attributes = {
            'click.shop': click.shop,
            'click.card': click.card,
            'click.group': click.group,
            'click.view': click.view,
            'click.best': click.best,
            'visitor.id': visitors.id(client, req.headers.get('user-agent'))
        };
        if (click.price !== null) attributes['click.price'] = click.price;
        tracer
            .startSpan(
                'offer click',
                { kind: SpanKind.SERVER, attributes },
                requestContext(req)
            )
            .end();
        return new Response(null, { status: 204 });
    };
}
