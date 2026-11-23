// An offer's extra line: an auction's countdown and bids, or what a trader's list says of the card.
import { Hourglass } from 'lucide-react';
import { useNow } from '@/hooks/use-now';
import { formatPrice, formatShortDate, timeLeft } from '@/lib/format';
import { BIDS, plural } from '@/shared/i18n';
import type { AuctionInfo, CardResult } from '@/shared/search-result';

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

// What a trader's list says of the printing, and how fresh the list is: "RVR · retro · оновлено 17 лист."
// A list that names no printing still gets an image, Scryfall's default printing; saying so keeps it from
// passing for the trader's.
export function SellerDetails({ link }: { link: CardResult }) {
    const { printing, updatedAt } = link.seller!;
    return (
        <span className='text-xs text-muted-foreground'>
            {printing ?? 'друк не вказано'} · оновлено{' '}
            {formatShortDate(updatedAt)}
        </span>
    );
}
