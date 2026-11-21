import { useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type { ListStatus } from '@/account';
import { ModeratedListItem, type Act } from '@/components/moderated-list-item';
import {
    Loading,
    Notice,
    PageLayout,
    SERVER_ERROR
} from '@/components/page-layout';
import { SellerItem } from '@/components/seller-item';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAccount } from '@/hooks/use-account';
import { useLoader } from '@/hooks/use-loader';
import { LISTS, plural } from '@/i18n';
import {
    ApiError,
    fetchQueue,
    fetchSellers,
    refreshLists,
    searchLists
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

    // the sellers' tab loads its own (Sellers)
    const lists = useLoader(
        tab === 'sellers'
            ? null
            : () => (query ? searchLists(query) : fetchQueue(tab)),
        [tab, query, reloads],
        fail
    );
    // a new load: an earlier one's error (or a failed action's) no longer applies, nor do the ticks
    useEffect(() => {
        setError(null);
        setSelected(new Set());
    }, [tab, query, reloads]);

    const act: Act = async (action) => {
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

            {/* filters over one list rather than tabs with panels of their own, so pressed buttons, not a tablist */}
            <div
                role='group'
                aria-label='Що показати'
                className='flex flex-wrap gap-2'
            >
                {TABS.map((t) => (
                    <Button
                        key={t.tab}
                        aria-pressed={current(t.tab)}
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
                                    <ModeratedListItem
                                        key={list.id}
                                        list={list}
                                        selected={selected.has(list.id)}
                                        onSelect={() =>
                                            setSelected((s) =>
                                                toggle(s, list.id)
                                            )
                                        }
                                        busy={busy}
                                        act={act}
                                    />
                                ))}
                            </ul>
                        )
                    )}
                </>
            )}
        </>
    );
}

// The "Продавці" tab: every seller (or those the search finds), most recently signed in first.
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
    act: Act;
    onShowLists: (username: string) => void;
}) {
    const sellers = useLoader(
        () => fetchSellers(query),
        [query, reloads],
        reloadIfSignedOut
    );

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
                    <SellerItem
                        key={seller.id}
                        seller={seller}
                        busy={busy}
                        act={act}
                        onShowLists={() => onShowLists(seller.username)}
                    />
                ))}
            </ul>
        </>
    );
}

// The lists are read in the background, one every few seconds per source, so the tab shows the new reads only later.
// None queued: the lists asked for aren't approved, or their seller is banned (ListStore.refreshNow).
async function refresh(ids: number[] | 'all') {
    const { refreshed } = await refreshLists(ids);
    return refreshed.length === 0
        ? 'Немає списків, які можна оновити: їх не схвалено або продавця заблоковано.'
        : `Поставлено в чергу на оновлення: ${plural(refreshed.length, LISTS)}. Нові дані з’являться тут за кілька хвилин.`;
}

const toggle = (set: ReadonlySet<number>, id: number) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
};
