import { Trash2 } from 'lucide-react';
import type { MyList } from '@/account';
import { ListName, ListStatusLine } from '@/components/list-parts';
import { RateField } from '@/components/rate-field';
import { Button } from '@/components/ui/button';

// One of a trader's own lists on /lists: its name and state, its own exchange rate (over `defaultRate`, the
// trader's rate for all their lists), and the way to delete it.
export function MyListItem({
    list,
    defaultRate,
    onSaveRate,
    onRemove
}: {
    list: MyList;
    defaultRate: number | null;
    onSaveRate: (usdRate: number | null) => Promise<unknown>;
    onRemove: () => void;
}) {
    return (
        <li className='flex items-center gap-3 rounded-lg border bg-card px-4 py-3'>
            <div className='grid min-w-0 flex-1 gap-1.5'>
                <div className='grid gap-0.5'>
                    <ListName list={list} />
                    <ListStatusLine list={list} />
                </div>
                <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground'>
                    <span>Курс цього списку:</span>
                    <RateField
                        compact
                        value={list.usdRate}
                        onSave={onSaveRate}
                        placeholder={
                            defaultRate === null
                                ? 'не вказано'
                                : defaultRate.toLocaleString('uk-UA')
                        }
                        hint={defaultRate === null ? undefined : 'як загальний'}
                        label='Курс долара для цього списку'
                    />
                </div>
            </div>
            <Button
                variant='ghost'
                size='icon-sm'
                onClick={onRemove}
                title='Видалити список'
                aria-label='Видалити список'
            >
                <Trash2 />
            </Button>
        </li>
    );
}
