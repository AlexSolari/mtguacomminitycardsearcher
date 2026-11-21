import { Ban, Check, Undo2, X } from 'lucide-react';
import type { ModeratedList } from '@/account';
import { formatDate, ListName, ListStatusLine } from '@/components/list-parts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reviewList, setBanned } from '@/lib/account-api';

// Runs a moderation action, then reloads what's shown; an action may say what it did (see Moderation).
export type Act = (action: () => Promise<string | void>) => void;

// A list on /admin: what it is, whose, its state, and what a moderator can do with it. An approved list can be
// ticked (`selected`) for a refresh.
export function ModeratedListItem({
    list,
    selected,
    onSelect,
    busy,
    act
}: {
    list: ModeratedList;
    selected: boolean;
    onSelect: () => void;
    busy: boolean;
    act: Act;
}) {
    return (
        <li className='grid gap-3 rounded-lg border bg-card px-4 py-3'>
            <div className='flex min-w-0 items-start gap-3'>
                {list.status === 'approved' && (
                    <input
                        type='checkbox'
                        aria-label='Вибрати для оновлення'
                        checked={selected}
                        onChange={onSelect}
                        className='mt-1 size-4 shrink-0 accent-primary'
                    />
                )}
                <div className='grid min-w-0 gap-0.5'>
                    <ListName list={list} />
                    <ListStatusLine list={list} />
                    <Owner list={list} />
                </div>
            </div>
            <div className='flex flex-wrap gap-2'>
                {list.status !== 'approved' && (
                    <Button
                        size='sm'
                        disabled={busy}
                        onClick={() =>
                            act(() => reviewList(list.id, 'approved'))
                        }
                    >
                        <Check />
                        Схвалити
                    </Button>
                )}
                {list.status !== 'rejected' && (
                    <Button
                        size='sm'
                        variant='outline'
                        disabled={busy}
                        onClick={() =>
                            act(() => reviewList(list.id, 'rejected'))
                        }
                    >
                        <X />
                        Відхилити
                    </Button>
                )}
                <BanButton
                    banned={list.owner.banned}
                    username={list.owner.username}
                    disabled={busy}
                    onToggle={(banned) =>
                        act(() => setBanned(list.owner.id, banned))
                    }
                />
            </div>
        </li>
    );
}

function Owner({ list }: { list: ModeratedList }) {
    const { owner } = list;
    return (
        <p className='text-sm text-muted-foreground'>
            {owner.displayName}{' '}
            <a
                href={`https://t.me/${owner.username}`}
                target='_blank'
                rel='noopener noreferrer'
                className='text-primary hover:underline'
            >
                @{owner.username}
            </a>
            {owner.banned && (
                <span className='text-destructive'> · заблоковано</span>
            )}
            {' · додано '}
            {formatDate(list.createdAt)}
            {' · '}
            <RateNote list={list} />
        </p>
    );
}

// The exchange rate the list's prices show at in search, and whose it is. Sellers change it without review.
function RateNote({ list }: { list: ModeratedList }) {
    const rate = list.usdRate ?? list.owner.usdRate;
    if (rate === null) return <>курс не вказано, ціни в доларах</>;
    return (
        <>
            курс{' '}
            <span className='font-medium text-foreground tabular-nums'>
                {rate.toLocaleString('uk-UA')} ₴ за $1
            </span>{' '}
            ({list.usdRate === null ? 'загальний' : 'для цього списку'})
        </>
    );
}

// A ban takes all of the trader's lists out of search and signs them out, so it asks first.
export function BanButton({
    banned,
    username,
    disabled,
    onToggle
}: {
    banned: boolean;
    username: string;
    disabled: boolean;
    onToggle: (banned: boolean) => void;
}) {
    return (
        <Button
            size='sm'
            variant='ghost'
            disabled={disabled}
            className={cn(!banned && 'text-destructive hover:text-destructive')}
            onClick={() => {
                if (
                    banned ||
                    confirm(
                        `Заблокувати @${username}? Усі списки цього продавця зникнуть із пошуку, а вхід на сайт буде закрито.`
                    )
                )
                    onToggle(!banned);
            }}
        >
            {banned ? <Undo2 /> : <Ban />}
            {banned ? 'Розблокувати' : 'Заблокувати'}
        </Button>
    );
}
