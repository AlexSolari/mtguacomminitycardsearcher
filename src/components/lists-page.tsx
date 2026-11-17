import { useEffect, useState, type FormEvent } from 'react';
import {
    Loader2,
    LogOut,
    Plus,
    ShieldCheck,
    Trash2,
    UserX
} from 'lucide-react';
import type {
    CurrentUser,
    LoginFailure,
    MyLists,
    SubmitListError
} from '@/account';
import { TelegramIcon } from '@/components/icons';
import { ListName, ListStatusLine } from '@/components/list-parts';
import {
    Loading,
    Notice,
    PageLayout,
    SERVER_ERROR
} from '@/components/page-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    submitList
} from '@/lib/account-api';

const LOGIN_FAILURES: Record<LoginFailure, string> = {
    cancelled: 'Вхід скасовано.',
    expired: 'Вхід не завершився вчасно. Спробуйте ще раз.',
    failed: 'Не вдалося увійти через Telegram. Спробуйте ще раз трохи згодом.',
    'no-username':
        'У вашому акаунті Telegram немає імені користувача (@username). Додайте його в налаштуваннях Telegram і увійдіть знову: без нього покупці не зможуть вам написати.',
    banned: 'Ваш акаунт заблоковано.'
};

const SUBMIT_ERRORS: Record<Exclude<SubmitListError, 'too-many'>, string> = {
    'invalid-link':
        'Це не посилання на список MTGGoldfish, ManaBox або Moxfield. Скопіюйте адресу сторінки зі списком.',
    taken: 'Цей список уже додано.'
};

// /lists, "Мої списки": traders sign in with Telegram and add their MTGGoldfish, ManaBox or Moxfield lists, which show in
// search once a moderator approves them. The sign-in comes back here, with ?login=<reason> when it failed.
export function ListsPage() {
    const auth = useAccount();
    // read once, then dropped from the address bar so a reload doesn't show it again
    const [loginFailure] = useState(
        () =>
            new URLSearchParams(location.search).get(
                'login'
            ) as LoginFailure | null
    );
    useEffect(() => {
        if (loginFailure) history.replaceState(null, '', location.pathname);
    }, []);

    return (
        <PageLayout title='Списки продавців'>
            {loginFailure && LOGIN_FAILURES[loginFailure] && (
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

function TraderLists({ user }: { user: CurrentUser }) {
    const [data, setData] = useState<MyLists | null>();
    const [link, setLink] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [added, setAdded] = useState(false);

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

    async function add(e: FormEvent) {
        e.preventDefault();
        if (!data || !link.trim()) return;
        setSubmitting(true);
        setError(null);
        setAdded(false);
        try {
            const list = await submitList(link.trim());
            setData({ ...data, lists: [list, ...data.lists] });
            setLink('');
            setAdded(true);
        } catch (err) {
            if (err instanceof ApiError && err.code === 'too-many')
                setError(
                    `Можна додати не більше ${plural(data.max, LISTS_GENITIVE)}.`
                );
            else if (
                err instanceof ApiError &&
                err.code &&
                err.code in SUBMIT_ERRORS
            )
                setError(SUBMIT_ERRORS[err.code as keyof typeof SUBMIT_ERRORS]);
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
        setAdded(false);
        try {
            await deleteList(id);
            setData({ ...data, lists: data.lists.filter((l) => l.id !== id) });
        } catch (err) {
            fail(err);
        }
    }

    const full = data ? data.lists.length >= data.max : false;
    return (
        <>
            <AccountBar user={user} />

            <section className='grid gap-3'>
                <p className='leading-relaxed text-muted-foreground'>
                    Додайте посилання на свій список на MTGGoldfish, ManaBox або
                    Moxfield. Після перевірки модератором карти з нього
                    з’являться в пошуку з вашим @{user.username}. Списки
                    оновлюються щоночі, тож достатньо тримати їх актуальними
                    там.
                </p>
                <form
                    onSubmit={add}
                    className='flex flex-col gap-2 sm:flex-row'
                >
                    <Input
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                        placeholder='https://www.mtggoldfish.com/deck/… або https://manabox.app/decks/…'
                        aria-label='Посилання на список'
                        aria-invalid={error !== null && !full}
                        disabled={!data || full}
                        className='h-10'
                    />
                    <Button
                        type='submit'
                        size='lg'
                        disabled={!data || full || submitting || !link.trim()}
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
                {added && (
                    <Notice tone='ok'>
                        Список додано. Він з’явиться в пошуку, щойно модератор
                        його схвалить.
                    </Notice>
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

            {data === undefined ? (
                <Loading />
            ) : data && data.lists.length > 0 ? (
                <ul className='grid gap-2'>
                    {data.lists.map((list) => (
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
