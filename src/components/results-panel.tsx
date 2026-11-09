import type { SearchEntry } from '@/hooks/use-card-search';
import { CardSection, CardSectionSkeleton } from '@/components/card-section';
import { SearchSummary } from '@/components/search-summary';
import { ViewToggle, type ResultsView } from '@/components/view-toggle';

// The summary and one section per searched card (a skeleton until its first shop answers).
export function ResultsPanel({
    entries,
    view,
    onViewChange
}: {
    entries: SearchEntry[];
    view: ResultsView;
    onViewChange: (view: ResultsView) => void;
}) {
    return (
        <>
            <div className='flex flex-col gap-3'>
                <SearchSummary entries={entries} />
                <div className='flex justify-end'>
                    <ViewToggle view={view} onChange={onViewChange} />
                </div>
            </div>
            {entries.map((entry) =>
                entry.result ? (
                    <CardSection
                        key={entry.card}
                        result={entry.result}
                        count={entry.count}
                        view={view}
                    />
                ) : (
                    <CardSectionSkeleton
                        key={entry.card}
                        name={entry.card}
                        count={entry.count}
                    />
                )
            )}
        </>
    );
}
