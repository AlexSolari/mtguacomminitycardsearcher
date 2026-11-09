import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { clickReporters, reportClick } from '@/lib/report-click';
import type { OfferClick } from '@/search-result';

const CLICK: OfferClick = {
    shop: 'carton',
    card: 'Sol Ring',
    group: 'exact',
    view: 'table',
    best: false,
    price: 120
};

// Bun has no sendBeacon; each test installs a fake one.
let beacon: ReturnType<typeof mock>;
beforeEach(() => {
    beacon = mock(() => true);
    Object.defineProperty(navigator, 'sendBeacon', {
        value: beacon,
        configurable: true
    });
});
afterEach(() => {
    delete (navigator as { sendBeacon?: unknown }).sendBeacon;
});

describe('reportClick', () => {
    test('beacons the click to /api/click as JSON', async () => {
        reportClick(CLICK);
        expect(beacon).toHaveBeenCalledTimes(1);
        const [url, body] = beacon.mock.calls[0] as [string, Blob];
        expect(url).toBe('/api/click');
        expect(body.type).toStartWith('application/json');
        expect(JSON.parse(await body.text())).toEqual(CLICK);
    });

    test('a failing beacon does not break the click', () => {
        beacon.mockImplementation(() => {
            throw new TypeError('blocked');
        });
        expect(() => reportClick(CLICK)).not.toThrow();
    });
});

describe('clickReporters', () => {
    test('reports a click and a middle click, not a right click', () => {
        const { onClick, onAuxClick } = clickReporters(CLICK);
        onClick();
        onAuxClick({ button: 1 }); // middle: opens the link in a new tab
        onAuxClick({ button: 2 }); // right: the context menu
        expect(beacon).toHaveBeenCalledTimes(2);
    });
});
