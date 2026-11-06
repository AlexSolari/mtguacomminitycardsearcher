import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CARDS, plural } from '@/i18n';

// The card list folded into a one-line bar after a search, so results get the full width.
export function CollapsedCardList({
    cardNames,
    onExpand
}: {
    cardNames: string[];
    onExpand: () => void;
}) {
    return (
        <div className='flex items-center gap-3 rounded-2xl border bg-card/60 px-4 py-2.5 shadow-2xl shadow-black/30 backdrop-blur animate-in fade-in duration-300'>
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
            <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-8 shrink-0 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground'
                onClick={onExpand}
                aria-controls='card-list-form'
                aria-expanded={false}
            >
                <Pencil className='size-3.5' />
                Змінити
            </Button>
        </div>
    );
}
