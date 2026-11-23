import { useEffect, useState } from 'react';

// Current time, refreshed every `intervalMs` — keeps countdowns moving while the page stays open.
export function useNow(intervalMs: number) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}
