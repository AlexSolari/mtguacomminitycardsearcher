// Pieces shared by the tile and table views of an offer: price, badges, image, auction countdown.
import { useEffect, useState } from 'react';
import { Hourglass, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TelegramIcon } from '@/components/icons';
import { useNearViewport } from '@/hooks/use-near-viewport';
import { BIDS, plural } from '@/i18n';
import type { AuctionInfo, CardResult } from '@/search-result';

export const formatPrice = (price: number) =>
    `${price.toLocaleString('uk-UA')} ₴`;

// Current time, refreshed every `intervalMs` — keeps countdowns moving while the page stays open.
function useNow(intervalMs: number) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

function timeLeft(iso: string, now: number) {
    const ms = new Date(iso).getTime() - now;
    if (!(ms > 0)) return 'завершено';
    const m = Math.floor(ms / 60_000);
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    return d > 0
        ? `ще ${d} д ${h} год`
        : h > 0
          ? `ще ${h} год ${m % 60} хв`
          : `ще ${m} хв`;
}

export function AuctionMeta({ auction }: { auction: AuctionInfo }) {
    const now = useNow(30_000); // minute precision is all the countdown shows
    return (
        <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground'>
            <span className='inline-flex items-center gap-1'>
                <Hourglass className='size-3' />
                {timeLeft(auction.endsAt, now)}
            </span>
            <span>·</span>
            <span>{plural(auction.bids, BIDS)}</span>
            {auction.buyNow !== null && (
                <>
                    <span>·</span>
                    <span>викуп {formatPrice(auction.buyNow)}</span>
                </>
            )}
        </div>
    );
}

export function CardImage({
    src,
    alt,
    className
}: {
    src: string | null;
    alt: string;
    className?: string;
}) {
    const [failed, setFailed] = useState(false);
    const [placeholder, near] = useNearViewport<HTMLDivElement>();
    if (src && !failed && !near) {
        // the card's bg-muted frame shows until the image is close enough to load
        return <div ref={placeholder} className='size-full' />;
    }
    if (!src || failed) {
        return (
            <div className='flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground'>
                <ImageOff className='size-6 opacity-60' />
                {alt}
            </div>
        );
    }
    return (
        <img
            src={src}
            alt={alt}
            onError={() => setFailed(true)}
            className={cn(
                'size-full rounded-[4.75%/3.5%] object-cover transition duration-500 ease-out group-hover:scale-[1.04]',
                className
            )}
        />
    );
}

export function Badge({
    className,
    children,
    title
}: {
    className?: string;
    children: React.ReactNode;
    title?: string;
}) {
    return (
        <span
            title={title}
            className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight shadow-lg',
                className
            )}
        >
            {children}
        </span>
    );
}

export const discountOf = (link: CardResult) =>
    link.oldPrice && link.price !== null
        ? Math.round((1 - link.price / link.oldPrice) * 100) || null
        : null;

// Price with its qualifier ("від" / "ставка" / "старт") and, for discounts, the struck-through old price.
export function PriceBlock({
    link,
    best
}: {
    link: CardResult;
    best: boolean;
}) {
    if (link.seller) return <TraderPrice link={link} />;
    return (
        <span className='flex flex-col items-end leading-tight'>
            {link.oldPrice !== undefined && (
                <span className='text-xs text-muted-foreground line-through tabular-nums'>
                    {formatPrice(link.oldPrice)}
                </span>
            )}
            <span
                className={cn(
                    'whitespace-nowrap text-sm font-semibold tabular-nums',
                    best ? 'text-primary' : 'text-foreground'
                )}
            >
                {(link.auction || link.fromPrice) && (
                    <span className='mr-1 text-xs font-normal text-muted-foreground'>
                        {link.auction
                            ? link.auction.currentBid !== null
                                ? 'ставка'
                                : 'старт'
                            : 'від'}
                    </span>
                )}
                {link.price === null ? '—' : formatPrice(link.price)}
            </span>
        </span>
    );
}

export const formatUsd = (usd: number) =>
    `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A trader's offer: Scryfall's price for the card in USD, as a guide; the trader names their own price.
// "≈" when it's for the card or its set rather than this exact printing.
function TraderPrice({ link }: { link: CardResult }) {
    return (
        <span
            className='whitespace-nowrap text-sm font-semibold tabular-nums text-foreground'
            title='Ціна Scryfall у доларах, для орієнтиру. Свою ціну назве продавець.'
        >
            {link.usdPrice === undefined ? (
                '—'
            ) : (
                <>
                    {link.approxPrice && (
                        <span className='mr-0.5 font-normal text-muted-foreground'>
                            ≈
                        </span>
                    )}
                    {formatUsd(link.usdPrice)}
                </>
            )}
        </span>
    );
}

// Who sells a trader's offer, in place of the shop badge: their Telegram username.
export function SellerBadge({
    link,
    className
}: {
    link: CardResult;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground',
                className
            )}
            title={link.seller!.name}
        >
            <TelegramIcon className='size-3.5 shrink-0 text-sky-600 dark:text-sky-400' />
            <span className='truncate'>@{link.seller!.username}</span>
        </span>
    );
}

// What a trader's list says of the printing, and how fresh the list is: "RVR · retro · оновлено 17 лист."
// A list that names no printing still gets an image, Scryfall's default printing; saying so keeps it from
// passing for the trader's.
export function SellerDetails({ link }: { link: CardResult }) {
    const { printing, updatedAt } = link.seller!;
    return (
        <span className='text-xs text-muted-foreground'>
            {printing ?? 'друк не вказано'} · оновлено{' '}
            {LIST_DATE.format(updatedAt)}
        </span>
    );
}

const LIST_DATE = new Intl.DateTimeFormat('uk', {
    day: 'numeric',
    month: 'short'
});

export const FOIL_BADGE =
    'bg-[linear-gradient(110deg,#f0abfc,#93c5fd_35%,#86efac_60%,#fde68a)] tracking-wider text-slate-900';
