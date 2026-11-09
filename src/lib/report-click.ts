import type { OfferClick } from '@/search-result';

// Tells the server which offer was opened (see click-route.ts). sendBeacon hands the request to the browser, so it
// never delays the link and isn't cancelled when the shop's tab opens. Best effort: a failure is ignored.
export function reportClick(click: OfferClick): void {
    try {
        navigator.sendBeacon(
            '/api/click',
            new Blob([JSON.stringify(click)], { type: 'application/json' })
        );
    } catch {
        // an ad blocker or an old browser; not worth breaking the click over
    }
}

// Handlers for an offer's link. A middle click opens it too, but fires `auxclick`, not `click`; a right click
// (the context menu) fires `auxclick` as well and opens nothing, so it isn't reported.
export function clickReporters(click: OfferClick) {
    return {
        onClick: () => reportClick(click),
        onAuxClick: (e: { button: number }) => {
            if (e.button === 1) reportClick(click);
        }
    };
}
