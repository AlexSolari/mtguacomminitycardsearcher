import {
    useEffect,
    useRef,
    useState,
    type DragEvent as ReactDragEvent,
    type FormEvent,
    type KeyboardEvent
} from 'react';
import {
    AlertTriangle,
    FileCheck,
    LayoutGrid,
    Link2Off,
    Loader2,
    PanelLeftClose,
    Pencil,
    Rows3,
    Search,
    Sparkles,
    Upload
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
    CardSection,
    CardSectionSkeleton,
    EmptyState,
    SearchSummary,
    ShopBadge,
    type ResultsView
} from '@/components/search-results';
import { SHOP_INFO, type SearchResult, type ShopId } from './shops';
import { parseCardList } from './decklist';
import { DeckFileError, deckFileToNames } from './deckfile';
import { CARDS, FILES, plural } from './i18n';

// Results layout (tiles / table), remembered per browser.
const VIEW_KEY = 'searcher:view';
function loadView(): ResultsView {
    try {
        return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid';
    } catch {
        return 'grid';
    }
}

function ViewToggle({
    view,
    onChange
}: {
    view: ResultsView;
    onChange: (v: ResultsView) => void;
}) {
    const options: {
        value: ResultsView;
        label: string;
        icon: typeof LayoutGrid;
    }[] = [
        { value: 'grid', label: 'Плитки', icon: LayoutGrid },
        { value: 'table', label: 'Таблиця', icon: Rows3 }
    ];
    return (
        <div
            role='radiogroup'
            aria-label='Вигляд результатів'
            className='inline-flex rounded-lg border bg-card/60 p-0.5 backdrop-blur'
        >
            {options.map(({ value, label, icon: Icon }) => (
                <button
                    key={value}
                    type='button'
                    role='radio'
                    aria-checked={view === value}
                    onClick={() => onChange(value)}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
                        view === value
                            ? 'bg-primary text-primary-foreground shadow'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    <Icon className='size-3.5' />
                    {label}
                </button>
            ))}
        </div>
    );
}

const DECK_FILE_ACCEPT = '.txt,.dec,.dek,.csv,.mwDeck,text/plain,text/csv';
const hasFiles = (e: ReactDragEvent) => e.dataTransfer.types.includes('Files');
import './index.css';

// One entry per searched card, in list order. Each card is fetched by its own request, so sections fill in
// as soon as their card is done instead of waiting for the slowest one.
type Entry = { card: string; result: SearchResult | null };

async function searchCard(
    card: string,
    signal: AbortSignal
): Promise<SearchResult> {
    try {
        const res = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cards: [card] }),
            signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { results: SearchResult[] };
        return data.results[0] ?? { card, links: [], errors: [] };
    } catch (err) {
        if (signal.aborted) throw err;
        console.error(`search for "${card}" failed`, err);
        return {
            card,
            links: [],
            errors: [{ message: (err as Error).message }]
        };
    }
}

export function App() {
    const [text, setText] = useState('');
    const [entries, setEntries] = useState<Entry[] | null>(null);
    const searchRef = useRef<AbortController | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [listCollapsed, setListCollapsed] = useState(false);
    const expandList = () => {
        setListCollapsed(false);
        requestAnimationFrame(() => textareaRef.current?.focus());
    };
    const dragDepth = useRef(0); // dragenter/leave fire for every child element; count to know when we truly left
    const [dragging, setDragging] = useState(false);
    const [importNote, setImportNote] = useState<{
        ok: boolean;
        text: string;
    } | null>(null);
    const [view, setView] = useState<ResultsView>(loadView);
    const changeView = (next: ResultsView) => {
        setView(next);
        try {
            localStorage.setItem(VIEW_KEY, next);
        } catch {} // private mode / blocked storage — the choice just won't persist
    };

    // A file dropped anywhere else on the page would make the browser navigate to it — swallow those drops.
    useEffect(() => {
        const block = (e: DragEvent) => {
            if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
        };
        window.addEventListener('dragover', block);
        window.addEventListener('drop', block);
        return () => {
            window.removeEventListener('dragover', block);
            window.removeEventListener('drop', block);
        };
    }, []);

    const { names: cardNames, links } = parseCardList(text);
    const submitting = entries?.some((e) => e.result === null) ?? false;
    const finished =
        entries?.flatMap((e) => (e.result ? [e.result] : [])) ?? [];

    function search() {
        if (cardNames.length === 0 || submitting) return;

        searchRef.current?.abort(); // drop any responses still in flight from a previous search
        const controller = new AbortController();
        searchRef.current = controller;

        setEntries(cardNames.map((card) => ({ card, result: null })));
        setListCollapsed(true); // fold the list into a one-line bar so results get the full width
        cardNames.forEach((card, i) => {
            searchCard(card, controller.signal)
                .then((result) => {
                    if (controller.signal.aborted) return;
                    setEntries(
                        (prev) =>
                            prev &&
                            prev.map((e, j) => (j === i ? { ...e, result } : e))
                    );
                })
                .catch(() => {}); // aborted
        });
    }

    // Read dropped/uploaded deck files in the browser and replace the list with the card names they contain.
    async function importFiles(fileList: FileList | File[]) {
        const files = Array.from(fileList);
        const names: string[] = [];
        const problems: string[] = [];
        for (const file of files) {
            try {
                names.push(...(await deckFileToNames(file)));
            } catch (err) {
                problems.push(
                    err instanceof DeckFileError
                        ? err.message
                        : `${file.name}: не вдалося прочитати файл`
                );
            }
        }
        const unique = parseCardList(names.join('\n')).names;
        if (unique.length > 0) setText(unique.join('\n'));

        const source =
            files.length === 1 ? files[0]!.name : plural(files.length, FILES);
        if (unique.length > 0)
            setImportNote({
                ok: true,
                text:
                    `Імпортовано ${plural(unique.length, CARDS)} з ${source}` +
                    (problems.length ? ` · ${problems.join('; ')}` : '')
            });
        else
            setImportNote({
                ok: false,
                text: problems.length
                    ? problems.join('; ')
                    : `У ${source} не знайдено карт`
            });
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        search();
    }

    function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            search();
        }
    }

    return (
        <div className='mx-auto flex max-w-7xl flex-col gap-10 px-4 py-10 sm:px-6 lg:py-14'>
            <header className='flex flex-col gap-3'>
                <div className='flex items-center gap-3'>
                    <div className='grid size-11 place-items-center rounded-xl bg-linear-to-br from-primary to-amber-600 text-primary-foreground shadow-lg shadow-primary/20'>
                        <Sparkles className='size-5' />
                    </div>
                    <h1 className='font-display text-2xl font-bold leading-tight tracking-wide sm:text-3xl lg:text-4xl'>
                        MTG UA Community{' '}
                        <span className='text-primary'>Card Searcher</span>
                    </h1>
                </div>
                <p className='flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground'>
                    Порівнюємо ціни в магазинах
                    {(Object.keys(SHOP_INFO) as ShopId[]).map((shop) => (
                        <ShopBadge
                            key={shop}
                            shop={shop}
                            link
                            className='rounded-full border bg-card/60 px-2.5 py-1 text-foreground'
                        />
                    ))}
                </p>
            </header>

            <main
                className={cn(
                    'grid items-start gap-8',
                    !listCollapsed && 'lg:grid-cols-[340px_1fr]'
                )}
            >
                <aside className={cn(!listCollapsed && 'lg:sticky lg:top-8')}>
                    {listCollapsed ? (
                        <div className='flex items-center gap-3 rounded-2xl border bg-card/60 px-4 py-2.5 shadow-2xl shadow-black/30 backdrop-blur animate-in fade-in duration-300'>
                            <span className='shrink-0 text-sm font-semibold'>
                                Список карт
                            </span>
                            <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground'>
                                {plural(cardNames.length, CARDS)}
                            </span>
                            <span
                                className='min-w-0 flex-1 truncate text-sm text-muted-foreground'
                                title={cardNames.join('\n')}
                            >
                                {cardNames.join(' · ')}
                            </span>
                            <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                className='h-8 shrink-0 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground'
                                onClick={expandList}
                                aria-controls='card-list-form'
                                aria-expanded={false}
                            >
                                <Pencil className='size-3.5' />
                                Змінити
                            </Button>
                        </div>
                    ) : (
                        <form
                            id='card-list-form'
                            onSubmit={handleSubmit}
                            className='flex flex-col gap-4 rounded-2xl border bg-card/60 p-5 shadow-2xl shadow-black/30 backdrop-blur'
                        >
                            <div className='flex items-center justify-between gap-2'>
                                <label
                                    htmlFor='card-list'
                                    className='text-sm font-semibold'
                                >
                                    Список карт
                                </label>
                                <div className='flex items-center gap-2'>
                                    <Button
                                        type='button'
                                        variant='ghost'
                                        size='sm'
                                        className='h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground'
                                        onClick={() =>
                                            fileInputRef.current?.click()
                                        }
                                        title='Завантажити файл колоди (.txt, .dec, .dek, .csv)'
                                    >
                                        <Upload className='size-3.5' />
                                        Файл
                                    </Button>
                                    <input
                                        ref={fileInputRef}
                                        type='file'
                                        accept={DECK_FILE_ACCEPT}
                                        multiple
                                        hidden
                                        onChange={(e) => {
                                            if (e.target.files?.length)
                                                importFiles(e.target.files);
                                            e.target.value = ''; // allow re-selecting the same file
                                        }}
                                    />
                                    <span className='rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground'>
                                        {plural(cardNames.length, CARDS)}
                                    </span>
                                    {entries && (
                                        <Button
                                            type='button'
                                            variant='ghost'
                                            size='sm'
                                            className='size-7 p-0 text-muted-foreground hover:text-foreground'
                                            onClick={() =>
                                                setListCollapsed(true)
                                            }
                                            title='Згорнути список'
                                            aria-label='Згорнути список'
                                            aria-expanded
                                        >
                                            <PanelLeftClose className='size-4' />
                                        </Button>
                                    )}
                                </div>
                            </div>
                            <div
                                className='relative'
                                onDragEnter={(e) => {
                                    if (!hasFiles(e)) return;
                                    e.preventDefault();
                                    dragDepth.current++;
                                    setDragging(true);
                                }}
                                onDragOver={(e) => {
                                    if (!hasFiles(e)) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'copy';
                                }}
                                onDragLeave={(e) => {
                                    if (!hasFiles(e)) return;
                                    if (--dragDepth.current <= 0)
                                        setDragging(false);
                                }}
                                onDrop={(e) => {
                                    if (!hasFiles(e)) return; // dropped text falls through to the textarea's default behaviour
                                    e.preventDefault();
                                    dragDepth.current = 0;
                                    setDragging(false);
                                    importFiles(e.dataTransfer.files);
                                }}
                            >
                                <Textarea
                                    ref={textareaRef}
                                    id='card-list'
                                    value={text}
                                    onChange={(e) => {
                                        setText(e.target.value);
                                        setImportNote(null);
                                    }}
                                    onKeyDown={handleKeyDown}
                                    placeholder={
                                        'Lightning Bolt\nCounterspell\n\n…або вставте експорт колоди:\n4 Demonic Tutor\n1 Sol Ring (C21) 263\n\n…або перетягніть сюди файл колоди'
                                    }
                                    spellCheck={false}
                                    className='min-h-64 max-h-[55vh] resize-none bg-background/50 font-mono text-sm leading-relaxed'
                                />
                                {dragging && (
                                    <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary bg-background/90 text-center backdrop-blur-sm animate-in fade-in duration-150'>
                                        <Upload className='size-7 text-primary' />
                                        <p className='text-sm font-semibold'>
                                            Відпустіть, щоб імпортувати колоду
                                        </p>
                                        <p className='text-xs text-muted-foreground'>
                                            .txt · .dec · .dek (MTGO) · .csv
                                        </p>
                                    </div>
                                )}
                            </div>
                            {importNote && (
                                <p
                                    className={cn(
                                        'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
                                        importNote.ok
                                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                            : 'border-destructive/30 bg-destructive/10 text-destructive'
                                    )}
                                >
                                    {importNote.ok ? (
                                        <FileCheck className='size-4 shrink-0' />
                                    ) : (
                                        <AlertTriangle className='size-4 shrink-0' />
                                    )}
                                    {importNote.text}
                                </p>
                            )}
                            {links.length > 0 && (
                                <div className='flex gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-xs leading-relaxed text-foreground'>
                                    <Link2Off className='mt-0.5 size-4 shrink-0 text-primary' />
                                    <p>
                                        Посилання на колоди не імпортуються
                                        напряму — MTGGoldfish блокує
                                        автоматичний доступ. На сторінці колоди
                                        скористайтеся кнопкою <b>Copy</b> /{' '}
                                        <b>Download</b> (текст, Arena або MTGO)
                                        і вставте список сюди.{' '}
                                        {links.length === 1
                                            ? 'Посилання пропущено.'
                                            : 'Посилання пропущені.'}
                                    </p>
                                </div>
                            )}
                            <Button
                                type='submit'
                                disabled={submitting || cardNames.length === 0}
                                className='h-11 bg-linear-to-r from-primary to-amber-500 font-semibold shadow-lg shadow-primary/20 transition hover:brightness-110'
                            >
                                {submitting ? (
                                    <Loader2 className='animate-spin' />
                                ) : (
                                    <Search />
                                )}
                                {submitting ? 'Шукаємо…' : 'Шукати в магазинах'}
                            </Button>
                            <p className='text-center text-xs text-muted-foreground'>
                                Назви або список колоди (MTGGoldfish, Arena,
                                MTGO) ·{' '}
                                <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px]'>
                                    Ctrl
                                </kbd>{' '}
                                +{' '}
                                <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px]'>
                                    Enter
                                </kbd>{' '}
                                — пошук
                            </p>
                        </form>
                    )}
                </aside>

                <div className='flex min-w-0 flex-col gap-10'>
                    {entries ? (
                        <>
                            <div className='flex flex-col gap-3'>
                                <SearchSummary
                                    results={finished}
                                    total={entries.length}
                                />
                                <div className='flex justify-end'>
                                    <ViewToggle
                                        view={view}
                                        onChange={changeView}
                                    />
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
                                    <CardSectionSkeleton
                                        key={entry.card}
                                        name={entry.card}
                                    />
                                )
                            )}
                        </>
                    ) : (
                        <EmptyState />
                    )}
                </div>
            </main>
        </div>
    );
}

export default App;
