import { memo } from 'react';
import { Crown, Gavel } from 'lucide-react';
import { clickReporters } from '@/lib/report-click';
import { cn } from '@/lib/utils';
import { offerKey } from '@/lib/results';
import type { CardResult, OfferGroup } from '@/shared/search-result';
import {
    AuctionMeta,
    Badge,
    ConditionBadge,
    discountOf,
    FoilBadge,
    LanguageBadge,
    PriceBlock,
    SellerBadge,
    SellerDetails
} from '@/components/offer-parts';
import { ShopBadge } from '@/components/shop-badge';
import { useNearViewport } from '@/hooks/use-near-viewport';

// Loads the image only once the row is about to scroll into view.
function Thumbnail({ src }: { src: string | null }) {
    const [ref, near] = useNearViewport<HTMLDivElement>();
    return (
        <div
            ref={ref}
            className='aspect-488/680 w-9 overflow-hidden rounded-sm bg-muted'
        >
            {src && near && (
                <img src={src} alt='' className='size-full object-cover' />
            )}
        </div>
    );
}

// Memoized: a section re-renders on every view switch, and its rows' props rarely change.
const ResultRow = memo(function ResultRow({
    link,
    best,
    card,
    group
}: {
    link: CardResult;
    best: boolean;
    card: string;
    group: OfferGroup;
}) {
    const discount = discountOf(link);
    const report = clickReporters({
        shop: link.shop,
        card,
        group,
        view: 'table',
        best,
        price: link.price
    });
    const open = () => {
        report.onClick();
        window.open(link.url, '_blank', 'noopener,noreferrer');
    };
    return (
        <tr
            onClick={open}
            className={cn(
                'group cursor-pointer border-b transition-colors last:border-0 hover:bg-primary/5',
                best && 'bg-primary/[0.07]'
            )}
        >
            <td className='py-1.5 pl-3'>
                <Thumbnail src={link.image} />
            </td>
            <td className='px-3 py-1.5'>
                {/* real link for keyboard / middle-click / copy-link; the row click covers the rest */}
                <a
                    href={link.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    onClick={(e) => {
                        e.stopPropagation();
                        report.onClick();
                    }}
                    onAuxClick={report.onAuxClick}
                    className='font-medium leading-snug group-hover:text-primary group-hover:underline'
                >
                    {link.name}
                </a>
                {link.auction && (
                    <div className='mt-0.5'>
                        <AuctionMeta auction={link.auction} />
                    </div>
                )}
                {link.seller && (
                    <div className='mt-0.5'>
                        <SellerDetails link={link} />
                        {' · '}
                        {/* the row opens the trader's Telegram; this, their whole list */}
                        <a
                            href={link.seller.list}
                            target='_blank'
                            rel='noopener noreferrer'
                            onClick={(e) => e.stopPropagation()}
                            className='text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline'
                        >
                            {link.seller.listTitle ?? 'список'}
                        </a>
                    </div>
                )}
            </td>
            <td className='px-3 py-1.5'>
                <div className='flex flex-wrap items-center gap-1'>
                    {best && (
                        <Badge className='bg-primary-fill text-primary-foreground shadow-none'>
                            <Crown className='size-3' />
                            Найкраща
                        </Badge>
                    )}
                    {link.auction && (
                        <Badge className='bg-muted text-foreground shadow-none'>
                            <Gavel className='size-3' />
                            Аукціон
                        </Badge>
                    )}
                    {link.foil && <FoilBadge />}
                    {discount !== null && (
                        <Badge className='bg-rose-600 text-white shadow-none'>
                            −{discount}%
                        </Badge>
                    )}
                    {link.language && (
                        <LanguageBadge language={link.language} />
                    )}
                    {link.condition && (
                        <ConditionBadge condition={link.condition} />
                    )}
                </div>
            </td>
            <td className='px-3 py-1.5'>
                {link.seller ? (
                    <SellerBadge link={link} className='max-w-40' />
                ) : (
                    <ShopBadge shop={link.shop} className='whitespace-nowrap' />
                )}
            </td>
            <td className='whitespace-nowrap px-3 py-1.5 text-right text-xs text-muted-foreground'>
                {link.stock !== undefined ? (
                    <span className='text-emerald-700 dark:text-emerald-400'>
                        {link.stock} шт.
                    </span>
                ) : (
                    '—'
                )}
            </td>
            <td className='py-1.5 pl-3 pr-4'>
                <PriceBlock link={link} best={best} />
            </td>
        </tr>
    );
});

// Table view: one compact row per offer; the whole row is a link.
export function ResultTable({
    links,
    isBest,
    card,
    group
}: {
    links: CardResult[];
    isBest: (l: CardResult) => boolean;
    card: string; // the card searched, for the click report
    group: OfferGroup;
}) {
    return (
        <div className='overflow-x-auto rounded-xl border bg-card/60 backdrop-blur-sm'>
            <table className='w-full min-w-160 text-sm'>
                <thead>
                    <tr className='border-b text-left text-xs uppercase tracking-wider text-muted-foreground'>
                        <th className='w-14 py-2.5 pl-3 font-medium' />
                        <th className='px-3 py-2.5 font-medium'>Карта</th>
                        <th className='px-3 py-2.5 font-medium'>Деталі</th>
                        <th className='px-3 py-2.5 font-medium'>Магазин</th>
                        <th className='px-3 py-2.5 text-right font-medium'>
                            Наявність
                        </th>
                        <th className='py-2.5 pl-3 pr-4 text-right font-medium'>
                            Ціна
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {links.map((link) => (
                        <ResultRow
                            key={offerKey(link)}
                            link={link}
                            best={isBest(link)}
                            card={card}
                            group={group}
                        />
                    ))}
                </tbody>
            </table>
        </div>
    );
}
