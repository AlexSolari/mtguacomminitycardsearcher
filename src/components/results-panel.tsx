import type { SearchResult } from '@/shops';
import type { SearchEntry } from '@/hooks/use-card-search';
import {
    CardSection,
    CardSectionSkeleton,
    SearchSummary,
    type ResultsView
} from '@/components/search-results';
import { ViewToggle } from '@/components/view-toggle';

// The summary and one section per searched card (a skeleton until it's done).
export function ResultsPanel({
    entries,
    finished,
    view,
    onViewChange
}: {
    entries: SearchEntry[];
    finished: SearchResult[];
    view: ResultsView;
    onViewChange: (view: ResultsView) => void;
}) {
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
