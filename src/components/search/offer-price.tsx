import { cn } from '@/lib/utils';
import { formatPrice, formatUsd } from '@/lib/format';
import { sellerUah } from '@/lib/results';
import type { CardResult } from '@/shared/search-result';

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
