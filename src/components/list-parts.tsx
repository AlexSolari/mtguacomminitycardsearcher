import { Fragment } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ListRefreshError, ListSource, MyList } from '@/account';
import { CARDS, plural } from '@/i18n';

export const SOURCE_LABELS: Record<ListSource, string> = {
    mtggoldfish: 'MTGGoldfish',
    manabox: 'ManaBox',
    moxfield: 'Moxfield'
};

// The sources' icons, loaded from their sites like the shops' (SHOP_INFO). MTGGoldfish's /favicon.ico is empty
// (it's behind Cloudflare), so it's the icon its pages link to.
const SOURCE_ICONS: Record<ListSource, string> = {
    mtggoldfish:
        'https://assets1.mtggoldfish.com/assets/goldfish-32-921a4c78.png',
    manabox: 'https://manabox.app/favicon.ico',
    moxfield: 'https://moxfield.com/favicon.ico'
};

// A source's name with its icon, as ShopBadge shows a shop's.
export function SourceName({ source }: { source: ListSource }) {
    return (
        <span className='inline-flex items-center gap-1 align-text-bottom font-medium text-foreground'>
            <img
                src={SOURCE_ICONS[source]}
                alt=''
                className='size-4 rounded-sm bg-foreground/5'
                loading='lazy'
            />
            {SOURCE_LABELS[source]}
        </span>
    );
}

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
