// Pieces shared by the tile and table views of an offer: price, badges, image, auction countdown.
import { useEffect, useState } from 'react';
import { Hourglass, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TelegramIcon } from '@/components/icons';
import { useNearViewport } from '@/hooks/use-near-viewport';
import { BIDS, plural } from '@/i18n';
import { sellerUah } from '@/results';
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

// A trader's offer: TCGplayer's price for the card (from Scryfall, or the list's own), as a guide; the trader
// names their own price. In UAH at the trader's rate when they set one, with the dollar price it came from
// underneath; otherwise in USD, with its source underneath. "≈" when it's for the card or its set rather than this
// exact printing.
function TraderPrice({ link }: { link: CardResult }) {
    const uah = sellerUah(link);
    const approx = link.approxPrice && (
        <span className='mr-0.5 font-normal text-muted-foreground'>≈</span>
    );
    if (link.usdPrice === undefined)
        return <span className='text-sm font-semibold text-foreground'>—</span>;
    if (uah === null)
        return (
            <span
                className='flex flex-col items-end leading-tight'
                title='Ціна TCGplayer у доларах, для орієнтиру. Свою ціну назве продавець.'
            >
                <span className='whitespace-nowrap text-sm font-semibold tabular-nums text-foreground'>
                    {approx}
                    {formatUsd(link.usdPrice)}
                </span>
                <span className='text-xs text-muted-foreground'>TCGplayer</span>
            </span>
        );
    return (
        <span
            className='flex flex-col items-end leading-tight'
            title='Ціна TCGplayer у доларах за курсом продавця, для орієнтиру. Остаточну ціну назве продавець.'
        >
            <span className='whitespace-nowrap text-sm font-semibold tabular-nums text-foreground'>
                {approx}
                {formatPrice(uah)}
            </span>
            <span className='whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
                TCGplayer {formatUsd(link.usdPrice)} ×{' '}
                {link.usdRate!.toLocaleString('uk-UA')}
            </span>
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

// An offer's foil, language and condition, the same in the table, the tiles and the order plan. Flat in a row of
// text; `overlay` on a card's image (the tiles), where they keep their shadow and the language reads white on black
// in both themes, as the image is behind it.
export function FoilBadge({ overlay }: { overlay?: boolean }) {
    return (
        <Badge className={cn(FOIL_BADGE, !overlay && 'shadow-none')}>
            FOIL
        </Badge>
    );
}

export function LanguageBadge({
    language,
    overlay
}: {
    language: string;
    overlay?: boolean;
}) {
    return (
        <Badge
            className={
                overlay
                    ? 'border border-white/25 bg-black/70 font-mono tracking-wide text-white backdrop-blur'
                    : 'border border-border bg-transparent font-mono text-foreground shadow-none'
            }
            title='Мова'
        >
            {language}
        </Badge>
    );
}

export function ConditionBadge({
    condition,
    overlay
}: {
    condition: string;
    overlay?: boolean;
}) {
    return (
        <Badge
            className={cn(
                'bg-sky-600/90 text-white',
                !overlay && 'shadow-none'
            )}
            title='Стан'
        >
            {condition}
        </Badge>
    );
}
