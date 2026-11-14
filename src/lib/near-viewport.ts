// Calls `onNear` once, when `el` comes within NEAR_VIEWPORT_MARGIN of the viewport.
// Native `loading='lazy'` starts 1250–2500 px early in Chrome, which on a results page means nearly every image
// loads at once; this waits until the image is about to scroll into view.
// One observer serves every element: a results page can hold hundreds of images.
export const NEAR_VIEWPORT_MARGIN = '500px 0px';

type Callback = () => void;

let observer: IntersectionObserver | null = null;
const callbacks = new Map<Element, Callback>();

function sharedObserver() {
    observer ??= new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const onNear = callbacks.get(entry.target);
                unwatch(entry.target);
                onNear?.();
            }
        },
        { rootMargin: NEAR_VIEWPORT_MARGIN }
    );
    return observer;
}

function unwatch(el: Element) {
    if (!callbacks.delete(el)) return;
    observer?.unobserve(el);
}

// Returns a function that stops watching. Without IntersectionObserver, `onNear` runs at once.
export function watchNearViewport(el: Element, onNear: Callback) {
    if (typeof IntersectionObserver === 'undefined') {
        onNear();
        return () => {};
    }
    callbacks.set(el, onNear);
    sharedObserver().observe(el);
    return () => unwatch(el);
}
