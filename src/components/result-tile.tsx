import { Crown, ExternalLink, Gavel, Package, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CardResult } from '@/search-result';
import type { ShopId } from '@/shops';
import {
    AuctionMeta,
    Badge,
    CardImage,
    discountOf,
    FOIL_BADGE,
    PriceBlock
} from '@/components/offer-parts';
import { ShopBadge } from '@/components/shop-badge';

export function ResultTile({
    link,
    best
}: {
    link: CardResult;
    best: boolean;
}) {
    const discount = discountOf(link);
    return (
        <a
            href={link.url}
            target='_blank'
            rel='noopener noreferrer'
            className={cn(
                'group relative flex flex-col overflow-hidden rounded-xl border bg-card/60 backdrop-blur-sm transition duration-300 ease-out',
                'hover:-translate-y-1 hover:border-primary/40 hover:bg-card hover:shadow-[0_18px_40px_-16px] hover:shadow-primary/25',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                best && 'border-primary/35 ring-1 ring-primary/20'
            )}
        >
            <div className='relative aspect-488/680 p-2 pb-0'>
                <div className='size-full overflow-hidden rounded-[4.75%/3.5%] bg-muted'>
                    <CardImage src={link.image} alt={link.name} />
                </div>
                {/* left: status + finish/discount badges, stacked */}
                <div className='absolute left-3.5 top-3.5 flex flex-col items-start gap-1'>
                    {best && (
                        <Badge className='bg-primary text-primary-foreground'>
                            <Crown className='size-3' />
                            Найкраща ціна
                        </Badge>
                    )}
                    {link.auction && (
                        <Badge className='bg-black/70 text-white backdrop-blur'>
                            <Gavel className='size-3' />
                            Аукціон
                        </Badge>
                    )}
                    {link.foil && <Badge className={FOIL_BADGE}>FOIL</Badge>}
                    {discount !== null && (
                        <Badge className='bg-rose-600 text-white'>
                            −{discount}%
                        </Badge>
                    )}
                </div>
                {/* right: language + condition */}
                {(link.language || link.condition) && (
                    <div className='absolute right-3.5 top-3.5 flex flex-col items-end gap-1'>
                        {link.language && (
                            <Badge
                                className='border border-white/25 bg-black/70 font-mono tracking-wide text-white backdrop-blur'
                                title='Мова'
                            >
                                {link.language}
                            </Badge>
                        )}
                        {link.condition && (
                            <Badge
                                className='bg-sky-600/90 text-white'
                                title='Стан'
                            >
                                {link.condition}
                            </Badge>
                        )}
                    </div>
                )}
                <span className='absolute bottom-1.5 right-3.5 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover:opacity-100'>
                    <ExternalLink className='size-3.5' />
                </span>
            </div>
            <div className='flex flex-1 flex-col gap-2 p-3'>
                <span className='line-clamp-2 text-sm font-medium leading-snug'>
                    {link.name}
                </span>
                {link.auction && <AuctionMeta auction={link.auction} />}
                {link.stock !== undefined && (
                    <div className='flex flex-wrap items-center gap-1.5 text-xs'>
                        <span className='inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400'>
                            <Package className='size-3' />
                            {link.stock} шт. в наявності
                        </span>
                    </div>
                )}
                <div className='mt-auto flex items-end justify-between gap-2'>
                    <ShopBadge shop={link.shop} />
                    <PriceBlock link={link} best={best} />
                </div>
            </div>
        </a>
    );
}

// Redirects to the card's image; the shop's own image is unknown since its search failed.
const scryfallImage = (card: string) =>
    `https://api.scryfall.com/cards/named?${new URLSearchParams({ exact: card, format: 'image', version: 'normal' })}`;

// Stands in for a shop whose search was blocked (see manualSearchUrl): greyed out, no price, links to the
// shop's search page. Not a CardResult, so it never counts as an offer or toward prices.
export function ManualCheckTile({
    shop,
    card,
    url
}: {
    shop: ShopId;
    card: string;
    url: string;
}) {
    return (
        <a
            href={url}
            target='_blank'
            rel='noopener noreferrer'
            className={cn(
                'group relative flex flex-col overflow-hidden rounded-xl border border-dashed bg-card/40 backdrop-blur-sm transition duration-300 ease-out',
                'hover:-translate-y-1 hover:border-primary/40 hover:bg-card',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
        >
            <div className='relative aspect-488/680 p-2 pb-0'>
                <div className='size-full overflow-hidden rounded-[4.75%/3.5%] bg-muted'>
                    <CardImage
                        src={scryfallImage(card)}
                        alt={card}
                        className='opacity-50 grayscale group-hover:opacity-70'
                    />
                </div>
                <div className='absolute inset-x-3.5 top-3.5'>
                    <Badge className='rounded-md bg-amber-400 text-slate-900'>
                        <SearchX className='size-3 shrink-0' />
                        Автоматичний пошук не вдався, перевірте вручну
                    </Badge>
                </div>
                <span className='absolute bottom-1.5 right-3.5 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover:opacity-100'>
                    <ExternalLink className='size-3.5' />
                </span>
            </div>
            <div className='flex flex-1 flex-col gap-2 p-3'>
                <span className='line-clamp-2 text-sm font-medium leading-snug text-muted-foreground'>
                    {card}
                </span>
                <div className='mt-auto flex items-end justify-between gap-2'>
                    <ShopBadge shop={shop} />
                    <span className='text-xs text-muted-foreground group-hover:text-primary'>
                        Шукати на сайті
                    </span>
                </div>
            </div>
        </a>
    );
}
