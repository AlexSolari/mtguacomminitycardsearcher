import { useState } from 'react';
import { parseFilters, type OfferFilters } from '@/filters';

// The results' filters, remembered per browser like the view (a convenience, not something to rely on).
const FILTERS_KEY = 'searcher:filters';

function loadFilters(): OfferFilters {
    try {
        return parseFilters(localStorage.getItem(FILTERS_KEY));
    } catch {
        return parseFilters(null);
    }
}

export function useOfferFilters() {
    const [filters, setFilters] = useState<OfferFilters>(loadFilters);
    const changeFilters = (next: OfferFilters) => {
        setFilters(next);
        try {
            localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
        } catch {} // private mode / blocked storage — the choice just won't persist
    };
    return [filters, changeFilters] as const;
}
