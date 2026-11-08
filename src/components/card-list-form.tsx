import { useRef, type KeyboardEvent, type Ref } from 'react';
import {
    AlertTriangle,
    FileCheck,
    Link2Off,
    Loader2,
    PanelLeftClose,
    Search,
    Upload
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatCardList } from '@/decklist';
import { useDeckImport, type ImportNote } from '@/hooks/use-deck-import';
import { useFileDrop } from '@/hooks/use-file-drop';
import { CARDS, plural } from '@/i18n';

const DECK_FILE_ACCEPT = '.txt,.dec,.dek,.csv,.mwDeck,text/plain,text/csv';

const PLACEHOLDER =
    'Lightning Bolt\nCounterspell\n\n…або вставте експорт колоди:\n4 Demonic Tutor\n1 Sol Ring (C21) 263\n\n…або перетягніть сюди файл колоди';

// The card list: typed/pasted names, or deck files picked with the "Файл" button or dropped onto the textarea.
export function CardListForm({
    text,
    onTextChange,
    cardNames,
    links,
    submitting,
    onSearch,
    onCollapse,
    textareaRef
}: {
    text: string;
    onTextChange: (text: string) => void;
    cardNames: string[];
    links: string[]; // deck URLs found in the text — they can't be fetched, so we explain what to do instead
    submitting: boolean;
    onSearch: () => void;
    onCollapse?: () => void; // shows the "fold" button (once there are results to make room for)
    textareaRef?: Ref<HTMLTextAreaElement>;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const deckImport = useDeckImport((cards) =>
        onTextChange(formatCardList(cards))
    );
    const drop = useFileDrop(deckImport.importFiles);

    function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSearch();
        }
    }

    return (
        <form
            id='card-list-form'
            onSubmit={(e) => {
                e.preventDefault();
                onSearch();
            }}
            className='flex flex-col gap-4 rounded-2xl border bg-card/60 p-5 shadow-2xl shadow-black/10 dark:shadow-black/30 backdrop-blur'
        >
            <div className='flex items-center justify-between gap-2'>
                <label htmlFor='card-list' className='text-sm font-semibold'>
                    Список карт
                </label>
                <div className='flex items-center gap-2'>
                    <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        className='h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground'
                        onClick={() => fileInputRef.current?.click()}
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
                                deckImport.importFiles(e.target.files);
                            e.target.value = ''; // allow re-selecting the same file
                        }}
                    />
                    <span className='rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground'>
                        {plural(cardNames.length, CARDS)}
                    </span>
                    {onCollapse && (
                        <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='size-7 p-0 text-muted-foreground hover:text-foreground'
                            onClick={onCollapse}
                            title='Згорнути список'
                            aria-label='Згорнути список'
                            aria-expanded
                        >
                            <PanelLeftClose className='size-4' />
                        </Button>
                    )}
                </div>
            </div>

            <div className='relative' {...drop.handlers}>
                <Textarea
                    ref={textareaRef}
                    id='card-list'
                    value={text}
                    onChange={(e) => {
                        onTextChange(e.target.value);
                        deckImport.clearNote();
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={PLACEHOLDER}
                    spellCheck={false}
                    className='min-h-[14em] max-h-[55vh] resize-none bg-background/50 font-mono text-sm leading-relaxed'
                />
                {drop.dragging && <DropOverlay />}
            </div>

            {deckImport.note && <ImportNoteMessage note={deckImport.note} />}
            {links.length > 0 && <DeckLinksNotice count={links.length} />}

            <Button
                type='submit'
                disabled={cardNames.length === 0}
                className='h-11 font-semibold shadow-lg shadow-primary/20 transition hover:brightness-95 dark:bg-linear-to-r dark:from-primary dark:to-amber-500 dark:hover:brightness-110'
            >
                {/* still clickable while searching: it restarts the search with the edited list */}
                {submitting ? <Loader2 className='animate-spin' /> : <Search />}
                {submitting ? 'Шукати заново' : 'Шукати в магазинах'}
            </Button>
            <SearchHint />
        </form>
    );
}

function DropOverlay() {
    return (
        <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary bg-background/90 text-center backdrop-blur-sm animate-in fade-in duration-150'>
            <Upload className='size-7 text-primary' />
            <p className='text-sm font-semibold'>
                Відпустіть, щоб імпортувати колоду
            </p>
            <p className='text-xs text-muted-foreground'>
                .txt · .dec · .dek (MTGO) · .csv
            </p>
        </div>
    );
}

function ImportNoteMessage({ note }: { note: ImportNote }) {
    return (
        <p
            className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
                note.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'
            )}
        >
            {note.ok ? (
                <FileCheck className='size-4 shrink-0' />
            ) : (
                <AlertTriangle className='size-4 shrink-0' />
            )}
            {note.text}
        </p>
    );
}

function DeckLinksNotice({ count }: { count: number }) {
    return (
        <div className='flex gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 text-xs leading-relaxed text-foreground'>
            <Link2Off className='mt-0.5 size-4 shrink-0 text-primary' />
            <p>
                Посилання на колоди не імпортуються напряму — MTGGoldfish блокує
                автоматичний доступ. На сторінці колоди скористайтеся кнопкою{' '}
                <b>Copy</b> / <b>Download</b> (текст, Arena або MTGO) і вставте
                список сюди.{' '}
                {count === 1 ? 'Посилання пропущено.' : 'Посилання пропущені.'}
            </p>
        </div>
    );
}

function Kbd({ children }: { children: string }) {
    return (
        <kbd className='rounded border bg-muted px-1.5 py-0.5 font-sans text-[10px]'>
            {children}
        </kbd>
    );
}

function SearchHint() {
    return (
        <p className='text-center text-xs text-muted-foreground'>
            Назви або список колоди (MTGGoldfish, Arena, MTGO) · <Kbd>Ctrl</Kbd>{' '}
            + <Kbd>Enter</Kbd> — пошук
        </p>
    );
}
