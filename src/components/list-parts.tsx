import { Fragment } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ListRefreshError, ListSource, MyList } from '@/account';
import { CARDS, plural } from '@/i18n';

export const SOURCE_LABELS: Record<ListSource, string> = {
    mtggoldfish: 'MTGGoldfish',
    manabox: 'ManaBox',
    moxfield: 'Moxfield'
};

// Why the last refresh failed; the cards from the refresh before stay in search meanwhile.
const REFRESH_ERRORS: Record<ListRefreshError, string> = {
    'not-found':
        'оновлення не вдалося: списку немає за посиланням (його видалили або закрили)',
    unreadable: 'оновлення не вдалося: не вийшло прочитати список',
    'too-large':
        'оновлення не вдалося: список завеликий, розділіть його на кілька',
    unavailable: 'оновлення не вдалося, спробуємо ще раз пізніше'
};

const DATE = new Intl.DateTimeFormat('uk', { dateStyle: 'medium' });
export const formatDate = (ms: number) => DATE.format(ms);

// The list's own name once it's been read, else its link; either opens the list.
export function ListName({ list }: { list: MyList }) {
    return (
        <a
            href={list.url}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex min-w-0 items-center gap-1.5 font-medium hover:text-primary'
        >
            <span className='truncate'>
                {list.title ?? list.url.replace(/^https:\/\/(www\.)?/, '')}
            </span>
            <ExternalLink className='size-3.5 shrink-0 text-muted-foreground' />
        </a>
    );
}

// Where the list stands: waiting for review, rejected, or approved and (once read) how many cards it has.
export function ListStatusLine({ list }: { list: MyList }) {
    const parts: { text: string; className?: string }[] = [
        { text: SOURCE_LABELS[list.source] },
        list.status === 'pending'
            ? {
                  text: 'чекає на перевірку',
                  className: 'text-amber-700 dark:text-amber-400'
              }
            : list.status === 'rejected'
              ? { text: 'відхилено', className: 'text-destructive' }
              : {
                    text: 'схвалено',
                    className: 'text-emerald-700 dark:text-emerald-400'
                }
    ];
    if (list.status === 'approved')
        parts.push(
            list.fetchedAt === null
                ? { text: 'карти ще завантажуються' }
                : {
                      text: `${plural(list.cardCount, CARDS)}, оновлено ${formatDate(list.fetchedAt)}`
                  }
        );
    if (list.lastError)
        parts.push({
            text: REFRESH_ERRORS[list.lastError],
            className: 'text-destructive'
        });
    return (
        <p className='text-sm text-muted-foreground'>
            {parts.map((p, i) => (
                <Fragment key={i}>
                    {i > 0 && ' · '}
                    <span className={p.className}>{p.text}</span>
                </Fragment>
            ))}
        </p>
    );
}
