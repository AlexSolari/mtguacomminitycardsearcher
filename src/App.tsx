import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { CardListForm } from '@/components/card-list-form';
import { CollapsedCardList } from '@/components/collapsed-card-list';
import { ResultsPanel } from '@/components/results-panel';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { useResultsView } from '@/components/view-toggle';
import { useCardSearch } from '@/hooks/use-card-search';
import { usePreventFileDropNavigation } from '@/hooks/use-file-drop';
import { parseCardList } from './decklist';
import './index.css';

export function App() {
    const [text, setText] = useState('');
    const { names: cardNames, links } = parseCardList(text);
    const { entries, finished, submitting, search } = useCardSearch();
    const [view, setView] = useResultsView();
    usePreventFileDropNavigation();

    // After a search the card list folds into a one-line bar, so results get the full width.
    const [listCollapsed, setListCollapsed] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const expandList = () => {
        setListCollapsed(false);
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const startSearch = () => {
        if (search(cardNames)) setListCollapsed(true);
    };

    // landing:   no search yet — just the card list, centered
    // collapsed: results at full width, the list folded into a bar above them
    // sidebar:   the list reopened for editing — a sticky column beside the results
    const layout = !entries
        ? 'landing'
        : listCollapsed
          ? 'collapsed'
          : 'sidebar';

    return (
        <div className='mx-auto flex min-h-dvh max-w-7xl flex-col gap-10 px-4 py-10 sm:px-6 lg:py-8'>
            <SiteHeader />

            {/* grid-cols-1 = minmax(0, 1fr): without it the single column grows to fit its widest content
                (e.g. the collapsed bar's long line of card names) and the whole page overflows */}
            <main
                className={cn(
                    'grid grid-cols-1 items-start gap-8',
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
                            onSearch={startSearch}
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
                    <div className='flex min-w-0 flex-col gap-10'>
                        <ResultsPanel
                            entries={entries}
                            finished={finished}
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
