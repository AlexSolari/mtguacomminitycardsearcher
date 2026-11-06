import type { SearchResult } from '@/shops';
import type { SearchEntry } from '@/hooks/use-card-search';
import {
    CardSection,
    CardSectionSkeleton,
    EmptyState,
    SearchSummary,
    type ResultsView
} from '@/components/search-results';
import { ViewToggle } from '@/components/view-toggle';

// Right-hand side of the page: the summary and one section per searched card (a skeleton until it's done),
// or the empty state before the first search.
export function ResultsPanel({
    entries,
    finished,
    view,
    onViewChange
}: {
    entries: SearchEntry[] | null;
    finished: SearchResult[];
    view: ResultsView;
    onViewChange: (view: ResultsView) => void;
}) {
    if (!entries) return <EmptyState />;
    return (
        <>
            <div className='flex flex-col gap-3'>
                <SearchSummary results={finished} total={entries.length} />
                <div className='flex justify-end'>
                    <ViewToggle view={view} onChange={onViewChange} />
                </div>
            </div>
            {entries.map((entry) =>
                entry.result ? (
                    <CardSection
                        key={entry.card}
                        result={entry.result}
                        view={view}
                    />
                ) : (
                    <CardSectionSkeleton key={entry.card} name={entry.card} />
                )
            )}
        </>
    );
}
