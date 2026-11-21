import { useEffect, useState, type FormEvent } from 'react';
import {
    Loader2,
    LogOut,
    Plus,
    Search,
    ShieldCheck,
    Trash2,
    UserX
} from 'lucide-react';
import type {
    CurrentUser,
    MyList,
    LoginFailure,
    MyLists,
    SkipReason,
    SubmittedLists
} from '@/account';
import { TelegramIcon } from '@/components/icons';
import {
    ListName,
    ListStatusLine,
    SOURCE_LABELS,
    SourceName
} from '@/components/list-parts';
import {
    Loading,
    Notice,
    PageLayout,
    SERVER_ERROR
} from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RateField } from '@/components/rate-field';
import { useAccount } from '@/hooks/use-account';
import { LISTS, LISTS_GENITIVE, plural } from '@/i18n';
import {
    ApiError,
    deleteAccount,
    deleteList,
    fetchMyLists,
    logout,
    setDefaultRate,
    setListRate,
    submitLists
} from '@/lib/account-api';

const LOGIN_FAILURES: Record<LoginFailure, string> = {
    cancelled: 'Вхід скасовано.',
    expired: 'Вхід не завершився вчасно. Спробуйте ще раз.',
    failed: 'Не вдалося увійти через Telegram. Спробуйте ще раз трохи згодом.',
    'no-username':
        'У вашому акаунті Telegram немає імені користувача (@username). Додайте його в налаштуваннях Telegram і увійдіть знову: без нього покупці не зможуть вам написати.',
    banned: 'Ваш акаунт заблоковано.'
};

const NO_LINKS =
    'Тут немає посилань на списки MTGGoldfish, ManaBox або Moxfield. Скопіюйте адресу сторінки зі списком або все повідомлення з посиланнями.';

// /lists, "Мої списки": traders sign in with Telegram and add their MTGGoldfish, ManaBox or Moxfield lists, which show in
// search once a moderator approves them. The sign-in comes back here, with ?login=<reason> when it failed.
export function ListsPage() {
    const auth = useAccount();
    // read once, then dropped from the address bar so a reload doesn't show it again
    // Only a reason we know: the address is anyone's to edit, and `?login=constructor` would otherwise find
    // Object's own properties.
    const [loginFailure] = useState(() => {
        const reason = new URLSearchParams(location.search).get('login');
        return reason !== null && Object.hasOwn(LOGIN_FAILURES, reason)
            ? (reason as LoginFailure)
            : null;
    });
    useEffect(() => {
        if (new URLSearchParams(location.search).has('login'))
            history.replaceState(null, '', location.pathname);
    }, []);

    return (
        <PageLayout title='Списки продавців'>
            {loginFailure && (
                <Notice tone='error'>{LOGIN_FAILURES[loginFailure]}</Notice>
            )}
            {auth === undefined ? (
                <Loading />
            ) : auth === null ? (
                <Notice tone='error'>{SERVER_ERROR}</Notice>
            ) : auth.user ? (
                <TraderLists user={auth.user} />
            ) : (
                <SignIn enabled={auth.loginEnabled} />
            )}
        </PageLayout>
    );
}

function SignIn({ enabled }: { enabled: boolean }) {
    return (
        <section className='grid gap-4'>
            <p className='leading-relaxed'>
                Продаєте карти в Telegram-групах? Додайте свій список із{' '}
                <b>MTGGoldfish</b>, <b>ManaBox</b> або <b>Moxfield</b>: після
                перевірки модератором карти з нього з’являться в результатах
                пошуку разом із вашим Telegram, щоб покупці могли вам написати.
            </p>
            {enabled ? (
                <Button asChild size='lg' className='justify-self-start'>
                    <a href='/api/auth/login'>
                        <TelegramIcon className='size-5' />
                        Увійти через Telegram
                    </a>
                </Button>
            ) : (
                <Notice>Вхід тимчасово недоступний.</Notice>
            )}
            <PrivacyNote />
        </section>
    );
}

// What signing in stores, and how to remove it. The session cookie is the only cookie, and only signed-in
// traders get it.
function PrivacyNote({ signedIn = false }: { signedIn?: boolean }) {
    return (
        <p className='text-xs leading-relaxed text-muted-foreground'>
            Що ми зберігаємо: ваш Telegram id, ім’я та @username (їх бачать
            покупці поруч із вашими картами), посилання на ваші списки й карти з
            них. Cookie ставимо лише для входу. Видалити все можна будь-коли
            {signedIn ? ' кнопкою нижче' : ' після входу'}.
        </p>
    );
}

// Deletes the account with its lists, after asking: there's no undo.
function DeleteAccount() {
    const [deleting, setDeleting] = useState(false);
    const [failed, setFailed] = useState(false);
    const remove = async () => {
        if (
            !confirm(
                'Видалити акаунт? Усі ваші списки зникнуть із пошуку, а дані про вас буде стерто. Це не можна скасувати.'
            )
        )
            return;
        setDeleting(true);
        setFailed(false);
        try {
            await deleteAccount();
            location.reload();
        } catch {
            setFailed(true);
            setDeleting(false);
        }
    };
    return (
        <section className='grid gap-2 border-t pt-4'>
            <PrivacyNote signedIn />
            <Button
                variant='ghost'
                size='sm'
                onClick={remove}
                disabled={deleting}
                className='justify-self-start text-destructive hover:text-destructive'
            >
                <UserX />
                Видалити акаунт
            </Button>
            {failed && <Notice tone='error'>{SERVER_ERROR}</Notice>}
        </section>
    );
}

// The search over a trader's own lists shows from this many lists on.
const SEARCH_FROM = 5;

// A piece of the list's title, source or link, any case.
function listMatcher(filter: string) {
    const needle = filter.trim().toLocaleLowerCase('uk');
    return (l: MyList) =>
        !needle ||
        [l.title ?? '', SOURCE_LABELS[l.source], l.url].some((f) =>
            f.toLocaleLowerCase('uk').includes(needle)
        );
}

function TraderLists({ user }: { user: CurrentUser }) {
    const [data, setData] = useState<MyLists | null>();
    const [filter, setFilter] = useState('');
    const [text, setText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<SubmittedLists | null>(null);

    // An expired session (401) starts over from the sign-in; anything else is the server's fault.
    const fail = (err: unknown) => {
        if (err instanceof ApiError && err.status === 401) location.reload();
        else setError(SERVER_ERROR);
    };

    useEffect(() => {
        fetchMyLists()
            .then(setData)
            .catch((err) => {
                setData(null);
                fail(err);
            });
    }, []);

    // One link, or a whole post with several (the way traders share their lists in Telegram groups).
    async function add(e?: FormEvent) {
        e?.preventDefault();
        if (!data || !text.trim() || submitting) return;
        setSubmitting(true);
        setError(null);
        setResult(null);
        try {
            const result = await submitLists(text);
            // from the latest state, not `data` as it was before the request: a delete may have finished meanwhile
            setData((d) => d && { ...d, lists: [...result.added, ...d.lists] });
            setText('');
            setResult(result);
        } catch (err) {
            if (err instanceof ApiError && err.code === 'no-links')
                setError(NO_LINKS);
            else fail(err);
        } finally {
            setSubmitting(false);
        }
    }

    // A failed save leaves the field as typed, to try again; the error shows above.
    async function saveDefaultRate(usdRate: number | null) {
        setError(null);
        try {
            await setDefaultRate(usdRate);
            setData((d) => d && { ...d, usdRate });
        } catch (err) {
            fail(err);
        }
    }

    async function saveListRate(id: number, usdRate: number | null) {
        setError(null);
        try {
            const list = await setListRate(id, usdRate);
            setData(
                (d) =>
                    d && {
                        ...d,
                        lists: d.lists.map((l) => (l.id === id ? list : l))
                    }
            );
        } catch (err) {
            fail(err);
        }
    }

    async function remove(id: number) {
        if (
            !data ||
            !confirm('Видалити цей список? Його карти зникнуть із пошуку.')
        )
            return;
        setError(null);
        setResult(null);
        try {
            await deleteList(id);
            // from the latest state: two deletes in a row mustn't bring the first list back
            setData(
                (d) => d && { ...d, lists: d.lists.filter((l) => l.id !== id) }
            );
        } catch (err) {
            fail(err);
        }
    }

    const full = data ? data.lists.length >= data.max : false;
    const shown = data?.lists.filter(listMatcher(filter)) ?? [];
    return (
        <>
            <AccountBar user={user} />

            <section className='grid gap-3'>
                <div className='grid gap-1 leading-relaxed text-muted-foreground'>
                    <p>
                        Додайте посилання на свій список або вставте
                        повідомлення з кількома посиланнями: додамо всі списки з
                        нього. Після перевірки модератором карти з нього
                        з’являться в пошуку. Списки оновлюються щоночі.
                    </p>
                    <p>
                        Підтримуються посилання на{' '}
                        <SourceName source='mtggoldfish' />,{' '}
                        <SourceName source='moxfield' />,{' '}
                        <SourceName source='manabox' />.
                    </p>
                </div>
                <form
                    onSubmit={add}
                    className='flex flex-col gap-2 sm:flex-row'
                >
                    {/* Enter adds, as a one-line field would; Shift+Enter starts a new line */}
                    <Textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                add();
                            }
                        }}
                        rows={1}
                        placeholder='https://www.mtggoldfish.com/deck/… або повідомлення з кількома посиланнями'
                        aria-label='Посилання на список або повідомлення з посиланнями'
                        aria-invalid={error === NO_LINKS}
                        disabled={!data || full}
                        className='max-h-60 min-h-10'
                    />
                    <Button
                        type='submit'
                        size='lg'
                        disabled={!data || full || submitting || !text.trim()}
                        className='sm:self-start'
                    >
                        {submitting ? (
                            <Loader2 className='animate-spin' />
                        ) : (
                            <Plus />
                        )}
                        Додати
                    </Button>
                </form>
                {error && <Notice tone='error'>{error}</Notice>}
                {result && data && (
                    <SubmitResult result={result} max={data.max} />
                )}
                {full && !error && (
                    <Notice>
                        У вас {plural(data!.max, LISTS)}: це максимум. Щоб
                        додати інший, видаліть один зі старих.
                    </Notice>
                )}
            </section>

            {data && (
                <section className='grid gap-2 rounded-lg border bg-card px-4 py-3'>
                    <h2 className='font-semibold'>Курс долара</h2>
                    <p className='text-sm leading-relaxed text-muted-foreground'>
                        Ціни у ваших списках — це ціни TCGplayer у доларах.
                        Вкажіть свій курс, і покупці бачитимуть їх у гривнях.
                        Без курсу ціни показуються в доларах. Для окремого
                        списку можна задати інший курс.
                    </p>
                    <RateField
                        value={data.usdRate}
                        onSave={saveDefaultRate}
                        placeholder='не вказано'
                        label='Курс долара для всіх списків'
                    />
                </section>
            )}

            {data && data.lists.length >= SEARCH_FROM && (
                <div className='relative'>
                    <Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
                    <Input
                        type='search'
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder='Пошук серед ваших списків: назва, сайт або посилання'
                        aria-label='Пошук серед ваших списків'
                        className='h-10 pl-9'
                    />
                </div>
            )}

            {data === undefined ? (
                <Loading />
            ) : data && data.lists.length > 0 && shown.length === 0 ? (
                <p className='text-muted-foreground'>Нічого не знайдено.</p>
            ) : data && data.lists.length > 0 ? (
                <ul className='grid gap-2'>
                    {shown.map((list) => (
                        <li
                            key={list.id}
                            className='flex items-center gap-3 rounded-lg border bg-card px-4 py-3'
                        >
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
                                        onSave={(rate) =>
                                            saveListRate(list.id, rate)
                                        }
                                        placeholder={
                                            data.usdRate === null
                                                ? 'не вказано'
                                                : data.usdRate.toLocaleString(
                                                      'uk-UA'
                                                  )
                                        }
                                        hint={
                                            data.usdRate === null
                                                ? undefined
                                                : 'як загальний'
                                        }
                                        label='Курс долара для цього списку'
                                    />
                                </div>
                            </div>
                            <Button
                                variant='ghost'
                                size='icon-sm'
                                onClick={() => remove(list.id)}
                                title='Видалити список'
                                aria-label='Видалити список'
                            >
                                <Trash2 />
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                data && (
                    <p className='text-muted-foreground'>
                        Ви ще не додали жодного списку.
                    </p>
                )
            )}

            <DeleteAccount />
        </>
    );
}

// What adding a post's links did: how many were added, and the links that weren't, with why.
function SubmitResult({
    result,
    max
}: {
    result: SubmittedLists;
    max: number;
}) {
    const n = result.added.length;
    const skipped = (reason: SkipReason) =>
        result.skipped.filter((s) => s.reason === reason).map((s) => s.url);
    const mine = skipped('mine');
    const taken = skipped('taken');
    const tooMany = skipped('too-many');
    return (
        <>
            {n > 0 && (
                <Notice tone='ok'>
                    {n === 1
                        ? 'Список додано. Він з’явиться в пошуку, щойно модератор його схвалить.'
                        : `Додано ${plural(n, LISTS)}. Вони з’являться в пошуку, щойно модератор їх схвалить.`}
                </Notice>
            )}
            {mine.length > 0 && (
                <Notice>
                    {n === 0 && result.skipped.length === 1
                        ? 'Цей список у вас уже є.'
                        : `Уже є у вас: ${plural(mine.length, LISTS)}.`}
                </Notice>
            )}
            {taken.length > 0 && (
                <Notice tone='error'>
                    {taken.length === 1
                        ? 'Цей список уже додав інший продавець:'
                        : 'Ці списки вже додали інші продавці:'}
                    <LinkList urls={taken} />
                </Notice>
            )}
            {tooMany.length > 0 && (
                <Notice tone='error'>
                    Не вмістилися: можна мати не більше{' '}
                    {plural(max, LISTS_GENITIVE)}. Видаліть старі, щоб додати
                    ці:
                    <LinkList urls={tooMany} />
                </Notice>
            )}
        </>
    );
}

function LinkList({ urls }: { urls: string[] }) {
    return (
        <ul className='mt-1 grid gap-0.5'>
            {urls.map((url) => (
                <li key={url} className='break-all'>
                    <a
                        href={url}
                        target='_blank'
                        rel='noreferrer'
                        className='underline underline-offset-2'
                    >
                        {url}
                    </a>
                </li>
            ))}
        </ul>
    );
}

// Who's signed in, the way out, and (for moderators) the way to the moderation page.
function AccountBar({ user }: { user: CurrentUser }) {
    const [leaving, setLeaving] = useState(false);
    const signOut = () => {
        setLeaving(true);
        logout()
            .catch(() => {})
            .finally(() => location.reload());
    };
    return (
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3'>
            <p className='mr-auto min-w-0'>
                Ви увійшли як <b>{user.displayName}</b>{' '}
                <span className='text-muted-foreground'>@{user.username}</span>
            </p>
            {user.admin && (
                <Button asChild variant='outline' size='sm'>
                    <a href='/admin'>
                        <ShieldCheck />
                        Модерація
                    </a>
                </Button>
            )}
            <Button
                variant='ghost'
                size='sm'
                onClick={signOut}
                disabled={leaving}
            >
                <LogOut />
                Вийти
            </Button>
        </div>
    );
}
