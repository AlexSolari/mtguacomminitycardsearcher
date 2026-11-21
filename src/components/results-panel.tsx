import { memo, useEffect, useMemo, useRef } from 'react';
import type { SearchEntry } from '@/hooks/use-card-search';
import { useOfferFilters } from '@/hooks/use-offer-filters';
import { usePlanView } from '@/hooks/use-plan-view';
import {
    filterResult,
    isFiltering,
    languageCounts,
    shopCounts
} from '@/filters';
import { isNotFound } from '@/results';
import {
    CardSection,
    CardSectionSkeleton,
    NotFoundSection
} from '@/components/card-section';
import { OfferFilters } from '@/components/offer-filters';
import { OrderPlanner } from '@/components/order-planner';
import { SearchSummary } from '@/components/search-summary';
import { ViewToggle, type ResultsView } from '@/components/view-toggle';

// The summary, the filters and one section per searched card (a skeleton until its first shop answers). As soon
// as every shop has answered for a card and none has it, the card moves out of the list into one compact block at
// the bottom. The filters apply to the sections and the summary; "none has it" is judged before them, so a card
// whose offers are all filtered out keeps its section and says so. The order plan replaces all of it while open.
// Memoized: the page re-renders on every keystroke in the card list, which changes none of its props (`entries`
// changes only as a search streams in, and the view's setter is stable).
export const ResultsPanel = memo(function ResultsPanel({
    entries,
    view,
    onViewChange
}: {
    entries: SearchEntry[];
    view: ResultsView;
    onViewChange: (view: ResultsView) => void;
}) {
    const [filters, setFilters] = useOfferFilters();
    const [planOpen, showPlan, hidePlan] = usePlanView();

    // recounted when the results or the filters change, not when the view does
    const { filtered, languages, shops } = useMemo(() => {
        const results = entries.flatMap((e) => (e.result ? [e.result] : []));
        const filtered = entries.map((e) => {
            const result = e.result && filterResult(e.result, filters);
            return {
                ...e,
                result,
                notFound: !!e.result && isNotFound(e.result),
                hidden:
                    (e.result?.links.length ?? 0) - (result?.links.length ?? 0)
            };
        });
        return {
            filtered,
            languages: languageCounts(results),
            shops: shopCounts(results)
        };
    }, [entries, filters]);

    // switching between the results and the plan starts the new one at its top, if that's scrolled away
    const top = useRef<HTMLDivElement>(null);
    const mounted = useRef(false);
    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true;
            return;
        }
        if (top.current && top.current.getBoundingClientRect().top < 0)
            top.current.scrollIntoView({ block: 'start' });
    }, [planOpen]);

    if (planOpen)
        return (
            <div ref={top} className='scroll-mt-4'>
                <OrderPlanner
                    entries={entries}
                    filters={filters}
                    onFiltersChange={setFilters}
                    onClose={hidePlan}
                />
            </div>
        );

    const notFound = filtered.filter((e) => e.notFound);
    const shown = filtered.filter((e) => !e.notFound);

    return (
        <>
            <div ref={top} className='flex scroll-mt-4 flex-col gap-3'>
                <SearchSummary
                    entries={filtered}
                    filtered={isFiltering(filters)}
                />
                <div className='flex flex-wrap items-start justify-between gap-2'>
                    <OfferFilters
                        filters={filters}
                        onChange={setFilters}
                        languages={languages}
                        shops={shops}
                        onPlan={showPlan}
                    />
                    <ViewToggle view={view} onChange={onViewChange} />
                </div>
            </div>
            {/* each section renders both views; this hides the one not chosen (`contents`: no box of its own, so
                the sections stay items of the page's column) */}
            <div data-view={view} className='group/results contents'>
                {shown.map((entry) =>
                    entry.result ? (
                        <CardSection
                            key={entry.card}
                            result={entry.result}
                            count={entry.count}
                            hidden={entry.hidden}
                        />
                    ) : (
                        <CardSectionSkeleton
                            key={entry.card}
                            name={entry.card}
                            count={entry.count}
                        />
                    )
                )}
                {notFound.length > 0 && (
                    <NotFoundSection
                        entries={notFound.map((e) => ({
                            id: e.card,
                            card: e.result?.card ?? e.card,
                            count: e.count,
                            typed: e.result?.typed
                        }))}
                    />
                )}
            </div>
        </>
    );
});
