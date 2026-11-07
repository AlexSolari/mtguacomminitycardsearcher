import { Pencil } from 'lucide-react';
import { CARDS, plural } from '@/i18n';

// The card list folded into a one-line bar after a search, so results get the full width.
// The whole bar is the button that reopens the list; "Змінити" is just its most visible part.
export function CollapsedCardList({
    cardNames,
    onExpand
}: {
    cardNames: string[];
    onExpand: () => void;
}) {
    return (
        <button
            type='button'
            onClick={onExpand}
            aria-controls='card-list-form'
            aria-expanded={false}
            title='Змінити список карт'
            className='group flex w-full cursor-pointer items-center gap-3 rounded-2xl border bg-card/60 px-4 py-2.5 text-left shadow-2xl shadow-black/30 backdrop-blur transition-colors animate-in fade-in duration-300 outline-none hover:border-primary/50 hover:bg-card/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
        >
            <span className='shrink-0 text-sm font-semibold'>Список карт</span>
            <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground'>
                {plural(cardNames.length, CARDS)}
            </span>
            <span
                className='min-w-0 flex-1 truncate text-sm text-muted-foreground'
                title={cardNames.join('\n')}
            >
                {cardNames.join(' · ')}
            </span>
            <span className='inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-3 text-xs font-semibold text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground'>
                <Pencil className='size-3.5' />
                Змінити
            </span>
        </button>
    );
}
