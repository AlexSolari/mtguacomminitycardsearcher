import { useState, type FormEvent } from 'react';
import { Loader2, Plus, Search } from 'lucide-react';
import type {
    CurrentUser,
    MyList,
    SkipReason,
    SubmittedLists
} from '@/shared/account';
import { SOURCE_LABELS, SourceName } from '@/components/lists/list-parts';
import { MyListItem } from '@/components/lists/my-list-item';
import { RateField } from '@/components/lists/rate-field';
import { AccountBar, DeleteAccount } from '@/components/lists/account';
import { Loading, Notice } from '@/components/layout/page-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NO_LINKS, useMyLists } from '@/hooks/use-my-lists';
import { LISTS, LISTS_GENITIVE, plural } from '@/shared/i18n';

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

// The signed-in trader's page: adding lists, their exchange rate, and their lists. The lists and the requests that
// change them are in useMyLists; this keeps what's on the page (the field, the last result, the search).
export function TraderLists({ user }: { user: CurrentUser }) {
    const { data, error, ...lists } = useMyLists();
    const [filter, setFilter] = useState('');
    const [text, setText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<SubmittedLists | null>(null);

    async function add(e?: FormEvent) {
        e?.preventDefault();
        if (!data || !text.trim() || submitting) return;
        setSubmitting(true);
        setResult(null);
        const added = await lists.add(text);
        if (added) {
            setText('');
            setResult(added);
        }
        setSubmitting(false);
    }

    async function remove(id: number) {
        if (!confirm('Видалити цей список? Його карти зникнуть із пошуку.'))
            return;
        setResult(null);
        await lists.remove(id);
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
                    {/* a failed save leaves the field as typed, to try again; the error shows above */}
                    <RateField
                        value={data.usdRate}
                        onSave={lists.saveDefaultRate}
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
                        <MyListItem
                            key={list.id}
                            list={list}
                            defaultRate={data.usdRate}
                            onSaveRate={(rate) =>
                                lists.saveListRate(list.id, rate)
                            }
                            onRemove={() => remove(list.id)}
                        />
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
