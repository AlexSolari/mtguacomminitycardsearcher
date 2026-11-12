import type { SearchEntry } from '@/hooks/use-card-search';
import { isNotFound } from '@/results';
import {
    CardSection,
    CardSectionSkeleton,
    NotFoundSection
} from '@/components/card-section';
import { SearchSummary } from '@/components/search-summary';
import { ViewToggle, type ResultsView } from '@/components/view-toggle';

// The summary and one section per searched card (a skeleton until its first shop answers). As soon as every shop
// has answered for a card and none has it, the card moves out of the list into one compact block at the bottom.
export function ResultsPanel({
    entries,
    view,
    onViewChange
}: {
    entries: SearchEntry[];
    view: ResultsView;
    onViewChange: (view: ResultsView) => void;
}) {
    const notFound = entries.filter((e) => e.result && isNotFound(e.result));
    const shown = notFound.length
        ? entries.filter((e) => !notFound.includes(e))
        : entries;

    return (
        <>
            <div className='flex flex-col gap-3'>
                <SearchSummary entries={entries} />
                <div className='flex justify-end'>
                    <ViewToggle view={view} onChange={onViewChange} />
                </div>
            </div>
            {shown.map((entry) =>
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
        </>
    );
}
