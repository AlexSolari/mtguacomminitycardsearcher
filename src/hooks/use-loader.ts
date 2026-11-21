import { useEffect, useState, type DependencyList } from 'react';

// What `load` gives, loaded again whenever `deps` change: undefined while loading (or while `load` is null, with
// nothing to load), null if it failed, which `onError` hears about. The answer to a load that a newer one replaced
// is dropped, so a slow answer for an old tab or search can't show over the current one.
export function useLoader<T>(
    load: (() => Promise<T>) | null,
    deps: DependencyList,
    onError?: (err: unknown) => void
): T | null | undefined {
    const [value, setValue] = useState<T | null>();
    useEffect(() => {
        setValue(undefined);
        if (!load) return;
        let live = true;
        load()
            .then((v) => live && setValue(v))
            .catch((err) => {
                if (!live) return;
                setValue(null);
                onError?.(err);
            });
        return () => {
            live = false;
        };
    }, deps);
    return value;
}
