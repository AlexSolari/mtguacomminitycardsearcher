import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { CardListForm } from '@/components/card-list-form';
import { CollapsedCardList } from '@/components/collapsed-card-list';
import { ResultsPanel } from '@/components/results-panel';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { useResultsView } from '@/components/view-toggle';
import { useCardSearch } from '@/hooks/use-card-search';
import { usePreventFileDropNavigation } from '@/hooks/use-file-drop';
import { cardListFromQuery, searchQuery } from '@/lib/search-url';
import { parseCardList, type CardEntry } from './decklist';
import './index.css';

export function App() {
    // a shared link (?q=…) opens with its card list filled in, and searches it straight away (below)
    const [text, setText] = useState(() => cardListFromQuery(location.search));
    const { cards, links } = parseCardList(text);
    const cardNames = cards.map((c) => c.name);
    const { entries, submitting, search } = useCardSearch();
    const [view, setView] = useResultsView();
    usePreventFileDropNavigation();

    // After a search the card list folds into a one-line bar, so results get the full width.
    const [listCollapsed, setListCollapsed] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const expandList = () => {
        setListCollapsed(false);
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    // The landing page is just the card list, so it's ready for typing or pasting straight away.
    useEffect(() => textareaRef.current?.focus(), []);

    // Starting a search scrolls the header out of view, so the results start at the top of the screen.
    const mainRef = useRef<HTMLElement>(null);
    const startSearch = (toSearch: CardEntry[] = cards) => {
        if (!search(toSearch)) return;
        // the search goes into the address bar, so copying it shares the search
        history.replaceState(null, '', searchQuery(toSearch));
        setListCollapsed(true);
        requestAnimationFrame(() =>
            mainRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            })
        );
    };

    // Deferred a tick and cancelled on cleanup: StrictMode mounts, unmounts and remounts in development, and the
    // unmount aborts a running search (useCardSearch), so only the final mount may start it.
    useEffect(() => {
        if (cards.length === 0) return;
        const timer = setTimeout(() => startSearch(cards));
        return () => clearTimeout(timer);
    }, []);

    // landing:   no search yet — just the card list, centered
    // collapsed: results at full width, the list folded into a bar above them
    // sidebar:   the list reopened for editing — a sticky column beside the results
    const layout = !entries
        ? 'landing'
        : listCollapsed
          ? 'collapsed'
          : 'sidebar';

    return (
        <div className='mx-auto flex min-h-dvh max-w-7xl flex-col gap-4 px-4 pt-6 pb-10 sm:gap-6 sm:px-6 sm:pt-10 lg:py-8'>
            <SiteHeader onTitleClick={expandList} />

            {/* grid-cols-1 = minmax(0, 1fr): without it the single column grows to fit its widest content
                (e.g. the collapsed bar's long line of card names) and the whole page overflows */}
            {/* min-h-dvh once there are results: a short page can't scroll the header away */}
            <main
                ref={mainRef}
                className={cn(
                    'grid scroll-mt-4 grid-cols-1 items-start gap-x-8 gap-y-4',
                    entries && 'min-h-dvh content-start',
                    layout === 'landing' && 'justify-items-center',
                    layout === 'sidebar' && 'lg:grid-cols-[340px_minmax(0,1fr)]'
                )}
            >
                <aside
                    className={cn(
                        'min-w-0',
                        layout === 'landing' && 'w-full max-w-2xl',
                        layout === 'sidebar' && 'lg:sticky lg:top-8'
                    )}
                >
                    {listCollapsed ? (
                        <CollapsedCardList
                            cardNames={cardNames}
                            onExpand={expandList}
                        />
                    ) : (
                        <CardListForm
                            text={text}
                            onTextChange={setText}
                            cardNames={cardNames}
                            links={links}
                            submitting={submitting}
                            onSearch={() => startSearch()}
                            onCollapse={
                                entries
                                    ? () => setListCollapsed(true)
                                    : undefined
                            }
                            textareaRef={textareaRef}
                        />
                    )}
                </aside>

                {entries && (
                    <div className='flex min-w-0 flex-col gap-6'>
                        <ResultsPanel
                            entries={entries}
                            view={view}
                            onViewChange={setView}
                        />
                    </div>
                )}
            </main>

            <SiteFooter />
        </div>
    );
}

export default App;
