import { useEffect, useState } from 'react';
import { Ban, Check, Undo2, X } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { fetchQueue, reviewList, setBanned } from '@/lib/account-api';

const TABS: { status: ListStatus; label: string }[] = [
    { status: 'pending', label: 'На перевірці' },
    { status: 'approved', label: 'Схвалені' },
    { status: 'rejected', label: 'Відхилені' }
];

// /admin: moderators (ADMIN_TELEGRAM_IDS) approve or reject submitted lists, and ban traders. Approving reads the
// list at once.
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
    const [busy, setBusy] = useState(false);
    const [reloads, setReloads] = useState(0);

    useEffect(() => {
        let live = true;
        setLists(undefined);
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

    // Runs a moderation action, then reloads the tab.
    const act = async (action: () => Promise<void>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
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
                                <div className='grid min-w-0 gap-0.5'>
                                    <ListName list={list} />
                                    <ListStatusLine list={list} />
                                    <Owner list={list} />
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
        </p>
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
