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

    return (
        <div className='mx-auto flex min-h-dvh max-w-7xl flex-col gap-10 px-4 py-10 sm:px-6 lg:py-8'>
            <SiteHeader />

            <main
                className={cn(
                    'grid items-start gap-8',
                    !listCollapsed && 'lg:grid-cols-[340px_1fr]'
                )}
            >
                <aside className={cn(!listCollapsed && 'lg:sticky lg:top-8')}>
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

                <div className='flex min-w-0 flex-col gap-10'>
                    <ResultsPanel
                        entries={entries}
                        finished={finished}
                        view={view}
                        onViewChange={setView}
                    />
                </div>
            </main>

            <SiteFooter />
        </div>
    );
}

export default App;
