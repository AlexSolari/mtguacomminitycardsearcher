import { Crown, Gavel } from 'lucide-react';
import { cn } from '@/lib/utils';
import { offerKey } from '@/results';
import type { CardResult } from '@/search-result';
import {
    AuctionMeta,
    Badge,
    discountOf,
    FOIL_BADGE,
    PriceBlock
} from '@/components/offer-parts';
import { ShopBadge } from '@/components/shop-badge';

// Table view: one compact row per offer; the whole row is a link.
export function ResultTable({
    links,
    isBest
}: {
    links: CardResult[];
    isBest: (l: CardResult) => boolean;
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
                    {links.map((link) => {
                        const best = isBest(link);
                        const discount = discountOf(link);
                        const open = () =>
                            window.open(
                                link.url,
                                '_blank',
                                'noopener,noreferrer'
                            );
                        return (
                            <tr
                                key={offerKey(link)}
                                onClick={open}
                                className={cn(
                                    'group cursor-pointer border-b transition-colors last:border-0 hover:bg-primary/5',
                                    best && 'bg-primary/[0.07]'
                                )}
                            >
                                <td className='py-1.5 pl-3'>
                                    <div className='aspect-488/680 w-9 overflow-hidden rounded-sm bg-muted'>
                                        {link.image && (
                                            <img
                                                src={link.image}
                                                alt=''
                                                loading='lazy'
                                                className='size-full object-cover'
                                            />
                                        )}
                                    </div>
                                </td>
                                <td className='px-3 py-1.5'>
                                    {/* real link for keyboard / middle-click / copy-link; the row click covers the rest */}
                                    <a
                                        href={link.url}
                                        target='_blank'
                                        rel='noopener noreferrer'
                                        onClick={(e) => e.stopPropagation()}
                                        className='font-medium leading-snug group-hover:text-primary group-hover:underline'
                                    >
                                        {link.name}
                                    </a>
                                    {link.auction && (
                                        <div className='mt-0.5'>
                                            <AuctionMeta
                                                auction={link.auction}
                                            />
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
                                        {link.foil && (
                                            <Badge
                                                className={cn(
                                                    FOIL_BADGE,
                                                    'shadow-none'
                                                )}
                                            >
                                                FOIL
                                            </Badge>
                                        )}
                                        {discount !== null && (
                                            <Badge className='bg-rose-600 text-white shadow-none'>
                                                −{discount}%
                                            </Badge>
                                        )}
                                        {link.language && (
                                            <Badge
                                                className='border border-border bg-transparent font-mono text-foreground shadow-none'
                                                title='Мова'
                                            >
                                                {link.language}
                                            </Badge>
                                        )}
                                        {link.condition && (
                                            <Badge
                                                className='bg-sky-600/90 text-white shadow-none'
                                                title='Стан'
                                            >
                                                {link.condition}
                                            </Badge>
                                        )}
                                    </div>
                                </td>
                                <td className='px-3 py-1.5'>
                                    <ShopBadge
                                        shop={link.shop}
                                        className='whitespace-nowrap'
                                    />
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
                    })}
                </tbody>
            </table>
        </div>
    );
}
