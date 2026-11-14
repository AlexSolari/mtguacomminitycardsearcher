import { afterAll, describe, expect, mock, test } from 'bun:test';
import { NEAR_VIEWPORT_MARGIN, watchNearViewport } from '@/lib/near-viewport';

// Stands in for the browser's IntersectionObserver; `fire` reports elements as near the viewport.
class FakeObserver {
    static instances: FakeObserver[] = [];
    observed = new Set<Element>();
    constructor(
        private callback: (entries: IntersectionObserverEntry[]) => void,
        public options: IntersectionObserverInit
    ) {
        FakeObserver.instances.push(this);
    }
    observe(el: Element) {
        this.observed.add(el);
    }
    unobserve(el: Element) {
        this.observed.delete(el);
    }
    fire(el: Element, isIntersecting = true) {
        this.callback([
            { target: el, isIntersecting } as IntersectionObserverEntry
        ]);
    }
}

const el = () => ({}) as Element;
const original = globalThis.IntersectionObserver;
afterAll(() => {
    globalThis.IntersectionObserver = original;
});

describe('watchNearViewport', () => {
    // runs first: the module creates its observer on the first watch that has one available
    test('runs the callback at once without IntersectionObserver', () => {
        // @ts-expect-error simulating a browser that lacks it
        delete globalThis.IntersectionObserver;
        const onNear = mock();
        const stop = watchNearViewport(el(), onNear);
        expect(onNear).toHaveBeenCalledTimes(1);
        stop(); // a no-op, safe to call from an effect cleanup
    });

    test('calls back once the element nears the viewport, then stops watching it', () => {
        globalThis.IntersectionObserver =
            FakeObserver as unknown as typeof IntersectionObserver;
        const a = el();
        const onNear = mock();
        watchNearViewport(a, onNear);
        const [observer] = FakeObserver.instances;
        expect(observer!.options.rootMargin).toBe(NEAR_VIEWPORT_MARGIN);
        expect(observer!.observed.has(a)).toBe(true);

        observer!.fire(a, false);
        expect(onNear).not.toHaveBeenCalled();

        observer!.fire(a);
        observer!.fire(a);
        expect(onNear).toHaveBeenCalledTimes(1);
        expect(observer!.observed.has(a)).toBe(false);
    });

    test('shares one observer between elements', () => {
        const a = el();
        const b = el();
        const onA = mock();
        const onB = mock();
        watchNearViewport(a, onA);
        watchNearViewport(b, onB);
        expect(FakeObserver.instances).toHaveLength(1);

        FakeObserver.instances[0]!.fire(b);
        expect(onB).toHaveBeenCalledTimes(1);
        expect(onA).not.toHaveBeenCalled();
    });

    test('the returned function stops watching', () => {
        const a = el();
        const onNear = mock();
        const stop = watchNearViewport(a, onNear);
        stop();
        const [observer] = FakeObserver.instances;
        expect(observer!.observed.has(a)).toBe(false);
        observer!.fire(a);
        expect(onNear).not.toHaveBeenCalled();
    });
});
