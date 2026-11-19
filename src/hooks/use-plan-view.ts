import { useEffect, useState } from 'react';

// The order planner is a view of the search page, not a page of its own (that would have to search again), marked
// by `#plan` in the address: Back returns to the results, and a shared `?q=…#plan` link opens on the plan.
const HASH = '#plan';

export function usePlanView() {
    const [open, setOpen] = useState(() => location.hash === HASH);
    useEffect(() => {
        const sync = () => setOpen(location.hash === HASH);
        addEventListener('popstate', sync);
        return () => removeEventListener('popstate', sync);
    }, []);

    const show = () => {
        if (location.hash !== HASH) history.pushState({ plan: true }, '', HASH);
        setOpen(true);
    };
    // Back to the results: undo the entry `show` added, or, on a link that opened on the plan, drop the hash.
    const hide = () => {
        if (history.state?.plan) history.back();
        else {
            history.replaceState(
                history.state,
                '',
                location.pathname + location.search
            );
            setOpen(false);
        }
    };
    return [open, show, hide] as const;
}
