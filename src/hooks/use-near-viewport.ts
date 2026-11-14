import { useEffect, useRef, useState } from 'react';
import { watchNearViewport } from '@/lib/near-viewport';

// True once the referenced element has come close to the viewport; stays true after that.
export function useNearViewport<T extends Element>() {
    const ref = useRef<T>(null);
    const [near, setNear] = useState(false);
    useEffect(() => {
        if (near || !ref.current) return;
        return watchNearViewport(ref.current, () => setNear(true));
    }, [near]);
    return [ref, near] as const;
}
