import { describe, expect, test } from 'bun:test';
import { SpanKind } from '@opentelemetry/api';
import type { OfferClick } from '@/search-result';
import {
    clickHandler,
    MAX_CLICK_BYTES,
    parseClick
} from '@/server/click-route';
import { VisitorIds } from '@/server/visitor-id';
import { captureSpans } from './capture-spans';

const spans = captureSpans();

const CLICK: OfferClick = {
    shop: 'carton',
    card: 'Sol Ring',
    group: 'exact',
    view: 'grid',
    best: true,
    price: 120
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/click', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { 'user-agent': 'Firefox', ...headers }
    });

// a fixed salt, so the expected visitor id can be computed
const visitors = () => new VisitorIds(undefined, () => 'salt');

describe('clickHandler', () => {
    test('records the click as a span and answers 204', async () => {
        const res = await clickHandler(visitors())(post(CLICK), '1.2.3.4');
        expect(res.status).toBe(204);
        expect(spans()).toMatchObject([
            {
                name: 'offer click',
                kind: SpanKind.SERVER,
                attributes: {
                    'click.shop': 'carton',
                    'click.card': 'Sol Ring',
                    'click.group': 'exact',
                    'click.view': 'grid',
                    'click.best': true,
                    'click.price': 120,
                    'visitor.id': visitors().id('1.2.3.4', 'Firefox')
                }
            }
        ]);
    });

    test('a manual check has no price, so none is recorded', async () => {
        await clickHandler(visitors())(
            post({ ...CLICK, group: 'manual', best: false, price: null }),
            '1.2.3.4'
        );
        expect(spans()[0]!.attributes).not.toHaveProperty('click.price');
    });

    test('a bad click is a 400 and records nothing', async () => {
        const handle = clickHandler(visitors());
        for (const body of [
            'not json',
            'null',
            '"a string"',
            { ...CLICK, shop: 'amazon' },
            { ...CLICK, shop: 'toString' }, // inherited, not a shop
            { ...CLICK, card: '   ' },
            { ...CLICK, card: 'x'.repeat(201) },
            { ...CLICK, group: 'sidebar' },
            { ...CLICK, view: 'list' },
            { ...CLICK, best: 'yes' },
            { ...CLICK, price: '120' },
            { ...CLICK, price: undefined }
        ]) {
            const res = await handle(post(body), '1.2.3.4');
            expect(res.status, JSON.stringify(body)).toBe(400);
        }
        expect(spans()).toHaveLength(0);
    });

    test('an oversized body is refused, by its length header or its actual size', async () => {
        const handle = clickHandler(visitors());
        const big = JSON.stringify({
            ...CLICK,
            pad: 'x'.repeat(MAX_CLICK_BYTES)
        });
        expect((await handle(post(big), '1.2.3.4')).status).toBe(400);
        // the header says small, the body isn't
        const lying = post(big);
        lying.headers.set('content-length', '10');
        expect((await handle(lying, '1.2.3.4')).status).toBe(400);
        expect(spans()).toHaveLength(0);
    });

    test('a body that cannot be read is a 400', async () => {
        const req = post(CLICK);
        await req.text(); // already consumed: reading it again rejects
        expect((await clickHandler(visitors())(req, '1.2.3.4')).status).toBe(
            400
        );
    });
});

describe('parseClick', () => {
    test('trims the card name', () => {
        expect(
            parseClick(JSON.stringify({ ...CLICK, card: '  Sol Ring ' }))
        ).toEqual(CLICK);
    });
});
