// Pieces shared by the tile and table views of an offer: price, badges, image, auction countdown.
import { useEffect, useState } from 'react';
import { Hourglass, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BIDS, plural } from '@/i18n';
import type { AuctionInfo, CardResult } from '@/shops';

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
            loading='lazy'
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

export const FOIL_BADGE =
    'bg-[linear-gradient(110deg,#f0abfc,#93c5fd_35%,#86efac_60%,#fde68a)] tracking-wider text-slate-900';
