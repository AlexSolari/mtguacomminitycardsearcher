import { useEffect, useState } from 'react';
import { Ban, Check, RefreshCw, Undo2, X } from 'lucide-react';
import type { ListStatus, ModeratedList } from '@/account';
import { formatDate, ListName, ListStatusLine } from '@/components/list-parts';
import {
    Loading,
    Notice,
    PageLayout,
    SERVER_ERROR
} from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { useAccount } from '@/hooks/use-account';
import { LISTS, plural } from '@/i18n';
import { cn } from '@/lib/utils';
import {
    fetchQueue,
    refreshLists,
    reviewList,
    setBanned
} from '@/lib/account-api';

const TABS: { status: ListStatus; label: string }[] = [
    { status: 'pending', label: 'На перевірці' },
    { status: 'approved', label: 'Схвалені' },
    { status: 'rejected', label: 'Відхилені' }
];

// /admin: moderators (ADMIN_TELEGRAM_IDS) approve or reject submitted lists, and ban traders. Approving reads the
// list at once; approved lists can be read again on demand, all of them or the ones ticked.
export function AdminPage() {
    const auth = useAccount();
    return (
        <PageLayout title='Модерація списків'>
            {auth === undefined ? (
                <Loading />
            ) : auth === null ? (
                <Notice tone='error'>{SERVER_ERROR}</Notice>
            ) : auth.user?.admin ? (
                <Moderation />
            ) : (
                <Notice>
                    Ця сторінка лише для модераторів.{' '}
                    {!auth.user && (
                        <a href='/lists' className='text-primary underline'>
                            Увійти
                        </a>
                    )}
                </Notice>
            )}
        </PageLayout>
    );
}

function Moderation() {
    const [status, setStatus] = useState<ListStatus>('pending');
    const [lists, setLists] = useState<ModeratedList[] | null>();
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [reloads, setReloads] = useState(0);
    // approved lists ticked for a refresh
    const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

    useEffect(() => {
        let live = true;
        setLists(undefined);
        setSelected(new Set());
        fetchQueue(status)
            .then((l) => live && setLists(l))
            .catch(() => {
                if (!live) return;
                setLists(null);
                setError(SERVER_ERROR);
            });
        return () => {
            live = false;
        };
    }, [status, reloads]);

    // Runs a moderation action, then reloads the tab. An action may say what it did.
    const act = async (action: () => Promise<string | void>) => {
        setBusy(true);
        setError(null);
        setDone(null);
        try {
            setDone((await action()) ?? null);
            setReloads((n) => n + 1);
        } catch {
            setError(SERVER_ERROR);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <div role='tablist' className='flex flex-wrap gap-2'>
                {TABS.map((tab) => (
                    <Button
                        key={tab.status}
                        role='tab'
                        aria-selected={status === tab.status}
                        variant={status === tab.status ? 'default' : 'outline'}
                        size='sm'
                        onClick={() => setStatus(tab.status)}
                    >
                        {tab.label}
                    </Button>
                ))}
            </div>

            {error && <Notice tone='error'>{error}</Notice>}
            {done && <Notice tone='ok'>{done}</Notice>}

            {status === 'approved' && lists && lists.length > 0 && (
                <div className='flex flex-wrap gap-2'>
                    <Button
                        size='sm'
                        variant='outline'
                        disabled={busy || selected.size === 0}
                        onClick={() => act(() => refresh([...selected]))}
                    >
                        <RefreshCw />
                        Оновити вибрані
                        {selected.size > 0 && ` (${selected.size})`}
                    </Button>
                    <Button
                        size='sm'
                        variant='outline'
                        disabled={busy}
                        onClick={() => act(() => refresh('all'))}
                    >
                        <RefreshCw />
                        Оновити всі
                    </Button>
                </div>
            )}

            {lists === undefined ? (
                <Loading />
            ) : lists && lists.length === 0 ? (
                <p className='text-muted-foreground'>Тут порожньо.</p>
            ) : (
                lists && (
                    <ul className='grid gap-2'>
                        {lists.map((list) => (
                            <li
                                key={list.id}
                                className='grid gap-3 rounded-lg border bg-card px-4 py-3'
                            >
                                <div className='flex min-w-0 items-start gap-3'>
                                    {list.status === 'approved' && (
                                        <input
                                            type='checkbox'
                                            aria-label='Вибрати для оновлення'
                                            checked={selected.has(list.id)}
                                            onChange={() =>
                                                setSelected((s) =>
                                                    toggle(s, list.id)
                                                )
                                            }
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
                                                act(() =>
                                                    reviewList(
                                                        list.id,
                                                        'approved'
                                                    )
                                                )
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
                                                act(() =>
                                                    reviewList(
                                                        list.id,
                                                        'rejected'
                                                    )
                                                )
                                            }
                                        >
                                            <X />
                                            Відхилити
                                        </Button>
                                    )}
                                    <BanButton
                                        list={list}
                                        disabled={busy}
                                        onToggle={(banned) =>
                                            act(() =>
                                                setBanned(list.owner.id, banned)
                                            )
                                        }
                                    />
                                </div>
                            </li>
                        ))}
                    </ul>
                )
            )}
        </>
    );
}

// The lists are read in the background, one every few seconds per source, so the tab shows the new reads only later.
async function refresh(ids: number[] | 'all') {
    const { refreshed } = await refreshLists(ids);
    return refreshed.length === 0
        ? 'Ці списки вже чекають на оновлення.'
        : `Поставлено в чергу на оновлення: ${plural(refreshed.length, LISTS)}. Нові дані з’являться тут за кілька хвилин.`;
}

const toggle = (set: ReadonlySet<number>, id: number) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
};

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
function BanButton({
    list,
    disabled,
    onToggle
}: {
    list: ModeratedList;
    disabled: boolean;
    onToggle: (banned: boolean) => void;
}) {
    const { banned, username } = list.owner;
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
