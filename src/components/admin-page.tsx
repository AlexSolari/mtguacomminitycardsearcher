import { useEffect, useState } from 'react';
import { Ban, Check, List, RefreshCw, Search, Undo2, X } from 'lucide-react';
import type { ListStatus, ModeratedList, ModeratedSeller } from '@/account';
import { formatDate, ListName, ListStatusLine } from '@/components/list-parts';
import {
    Loading,
    Notice,
    PageLayout,
    SERVER_ERROR
} from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAccount } from '@/hooks/use-account';
import { LISTS, plural } from '@/i18n';
import { cn } from '@/lib/utils';
import {
    ApiError,
    fetchQueue,
    fetchSellers,
    refreshLists,
    reviewList,
    searchLists,
    setBanned
} from '@/lib/account-api';

// The server's MAX_SEARCH_RESULTS: a search that fills it may have more.
const MAX_RESULTS = 50;
// Typing pauses this long before the search is sent.
const SEARCH_DELAY_MS = 250;

// An expired session (401) reloads the page, which then offers to sign in again, as /lists does; anything else is
// the server's fault, for the caller to show. Only a 401: on a 403 /me would still say "moderator", and the reload
// would loop.
function reloadIfSignedOut(err: unknown): boolean {
    if (!(err instanceof ApiError && err.status === 401)) return false;
    location.reload();
    return true;
}

// The lists in one state, or the sellers.
type Tab = ListStatus | 'sellers';
const TABS: { tab: Tab; label: string }[] = [
    { tab: 'pending', label: 'На перевірці' },
    { tab: 'approved', label: 'Схвалені' },
    { tab: 'rejected', label: 'Відхилені' },
    { tab: 'sellers', label: 'Продавці' }
];

// /admin: moderators (ADMIN_TELEGRAM_IDS) approve or reject submitted lists, and ban traders. Approving reads the
// list at once; approved lists can be read again on demand, all of them or the ones ticked. The search finds lists in
// any state, by seller, title or link, and shows them in place of the tab; on the "Продавці" tab it finds sellers.
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
    const [tab, setTab] = useState<Tab>('pending');
    const [lists, setLists] = useState<ModeratedList[] | null>();
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [reloads, setReloads] = useState(0);
    // approved lists ticked for a refresh
    const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
    const [text, setText] = useState('');
    const [query, setQuery] = useState('');

    const fail = (err: unknown) => {
        if (!reloadIfSignedOut(err)) setError(SERVER_ERROR);
    };

    useEffect(() => {
        const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DELAY_MS);
        return () => clearTimeout(timer);
    }, [text]);

    useEffect(() => {
        // a new load: an earlier one's error (or a failed action's) no longer applies
        setError(null);
        if (tab === 'sellers') return;
        let live = true;
        setLists(undefined);
        setSelected(new Set());
        (query ? searchLists(query) : fetchQueue(tab))
            .then((l) => live && setLists(l))
            .catch((err) => {
                if (!live) return;
                setLists(null);
                fail(err);
            });
        return () => {
            live = false;
        };
    }, [tab, query, reloads]);

    // Runs a moderation action, then reloads the tab. An action may say what it did.
    const act = async (action: () => Promise<string | void>) => {
        setBusy(true);
        setError(null);
        setDone(null);
        try {
            setDone((await action()) ?? null);
            setReloads((n) => n + 1);
        } catch (err) {
            fail(err);
        } finally {
            setBusy(false);
        }
    };

    const showTab = (next: Tab) => {
        setTab(next);
        setText('');
        setQuery('');
    };
    // a seller's lists: a search for their @username, which matches usernames from the start
    const showListsOf = (username: string) => {
        setTab('pending');
        setText(`@${username}`);
        setQuery(`@${username}`);
    };
    // the list tabs aren't highlighted while the search shows lists from all of them
    const current = (t: Tab) => tab === t && (t === 'sellers' || !query);
    const approved = lists?.some((l) => l.status === 'approved') ?? false;

    return (
        <>
            <div className='relative'>
                <Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
                <Input
                    type='search'
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={
                        tab === 'sellers'
                            ? 'Пошук продавця: @username або ім’я'
                            : 'Пошук: @продавець, ім’я, назва або посилання на список'
                    }
                    aria-label={
                        tab === 'sellers' ? 'Пошук продавців' : 'Пошук списків'
                    }
                    className='h-10 pl-9'
                />
            </div>

            <div role='tablist' className='flex flex-wrap gap-2'>
                {TABS.map((t) => (
                    <Button
                        key={t.tab}
                        role='tab'
                        aria-selected={current(t.tab)}
                        variant={current(t.tab) ? 'default' : 'outline'}
                        size='sm'
                        onClick={() => showTab(t.tab)}
                    >
                        {t.label}
                    </Button>
                ))}
            </div>

            {error && <Notice tone='error'>{error}</Notice>}
            {done && <Notice tone='ok'>{done}</Notice>}

            {tab === 'sellers' ? (
                <Sellers
                    query={query}
                    busy={busy}
                    reloads={reloads}
                    act={act}
                    onShowLists={showListsOf}
                />
            ) : (
                <>
                    {approved && (query || tab === 'approved') && (
                        <div className='flex flex-wrap gap-2'>
                            <Button
                                size='sm'
                                variant='outline'
                                disabled={busy || selected.size === 0}
                                onClick={() =>
                                    act(() => refresh([...selected]))
                                }
                            >
                                <RefreshCw />
                                Оновити вибрані
                                {selected.size > 0 && ` (${selected.size})`}
                            </Button>
                            {!query && (
                                <Button
                                    size='sm'
                                    variant='outline'
                                    disabled={busy}
                                    onClick={() => act(() => refresh('all'))}
                                >
                                    <RefreshCw />
                                    Оновити всі
                                </Button>
                            )}
                        </div>
                    )}

                    {query && lists && lists.length >= MAX_RESULTS && (
                        <p className='text-sm text-muted-foreground'>
                            Показано перші {MAX_RESULTS}: уточніть запит.
                        </p>
                    )}

                    {lists === undefined ? (
                        <Loading />
                    ) : lists && lists.length === 0 ? (
                        <p className='text-muted-foreground'>
                            {query ? 'Нічого не знайдено.' : 'Тут порожньо.'}
                        </p>
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
                                                    checked={selected.has(
                                                        list.id
                                                    )}
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
                                                banned={list.owner.banned}
                                                username={list.owner.username}
                                                disabled={busy}
                                                onToggle={(banned) =>
                                                    act(() =>
                                                        setBanned(
                                                            list.owner.id,
                                                            banned
                                                        )
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
            )}
        </>
    );
}

// The "Продавці" tab: every seller (or those the search finds), most recently signed in first, with their lists'
// states, exchange rate and dates; "Показати списки" opens their lists.
function Sellers({
    query,
    busy,
    reloads,
    act,
    onShowLists
}: {
    query: string;
    busy: boolean;
    reloads: number;
    act: (action: () => Promise<string | void>) => void;
    onShowLists: (username: string) => void;
}) {
    const [sellers, setSellers] = useState<ModeratedSeller[] | null>();
    useEffect(() => {
        let live = true;
        setSellers(undefined);
        fetchSellers(query)
            .then((s) => live && setSellers(s))
            .catch((err) => {
                if (live && !reloadIfSignedOut(err)) setSellers(null);
            });
        return () => {
            live = false;
        };
    }, [query, reloads]);

    if (sellers === undefined) return <Loading />;
    if (sellers === null) return <Notice tone='error'>{SERVER_ERROR}</Notice>;
    if (sellers.length === 0)
        return (
            <p className='text-muted-foreground'>
                {query ? 'Нікого не знайдено.' : 'Продавців ще немає.'}
            </p>
        );
    return (
        <>
            {sellers.length >= MAX_RESULTS && (
                <p className='text-sm text-muted-foreground'>
                    Показано перших {MAX_RESULTS}: уточніть запит.
                </p>
            )}
            <ul className='grid gap-2'>
                {sellers.map((seller) => (
                    <li
                        key={seller.id}
                        className='grid gap-3 rounded-lg border bg-card px-4 py-3'
                    >
                        <div className='grid min-w-0 gap-0.5'>
                            <p className='min-w-0 font-medium'>
                                {seller.displayName}{' '}
                                <a
                                    href={`https://t.me/${seller.username}`}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    className='font-normal text-primary hover:underline'
                                >
                                    @{seller.username}
                                </a>
                                {seller.admin && (
                                    <span className='font-normal text-muted-foreground'>
                                        {' '}
                                        · модератор
                                    </span>
                                )}
                                {seller.banned && (
                                    <span className='font-normal text-destructive'>
                                        {' '}
                                        · заблоковано
                                    </span>
                                )}
                            </p>
                            <SellerLists seller={seller} />
                            <p className='text-sm text-muted-foreground'>
                                {seller.usdRate === null
                                    ? 'курс не вказано'
                                    : `курс ${seller.usdRate.toLocaleString('uk-UA')} ₴ за $1`}
                                {' · з нами з '}
                                {formatDate(seller.createdAt)}
                                {' · останній вхід '}
                                {formatDate(seller.lastLoginAt)}
                            </p>
                        </div>
                        <div className='flex flex-wrap gap-2'>
                            <Button
                                size='sm'
                                variant='outline'
                                onClick={() => onShowLists(seller.username)}
                            >
                                <List />
                                Показати списки
                            </Button>
                            {!seller.admin && (
                                <BanButton
                                    banned={seller.banned}
                                    username={seller.username}
                                    disabled={busy}
                                    onToggle={(banned) =>
                                        act(() => setBanned(seller.id, banned))
                                    }
                                />
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </>
    );
}

// "2 схвалені · 1 на перевірці", leaving out states with none; "списків немає" without any.
function SellerLists({ seller }: { seller: ModeratedSeller }) {
    const { pending, approved, rejected } = seller.lists;
    const parts = [
        approved > 0 && {
            text: `схвалено ${approved}`,
            className: 'text-emerald-700 dark:text-emerald-400'
        },
        pending > 0 && {
            text: `на перевірці ${pending}`,
            className: 'text-amber-700 dark:text-amber-400'
        },
        rejected > 0 && {
            text: `відхилено ${rejected}`,
            className: 'text-destructive'
        }
    ].filter((p) => p !== false);
    return (
        <p className='text-sm text-muted-foreground'>
            {parts.length === 0
                ? 'списків немає'
                : parts.map((p, i) => (
                      <span key={p.text}>
                          {i > 0 && ' · '}
                          <span className={p.className}>{p.text}</span>
                      </span>
                  ))}
        </p>
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
