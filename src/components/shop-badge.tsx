import { cn } from '@/lib/utils';
import { SHOP_INFO, type ShopId } from '@/shops';

export function ShopBadge({
    shop,
    className,
    link
}: {
    shop: ShopId;
    className?: string;
    link?: boolean;
}) {
    const info = SHOP_INFO[shop];
    const content = (
        <>
            <img
                src={info.icon}
                alt=''
                className='size-4 rounded-sm bg-foreground/5'
                loading='lazy'
            />
            {info.label}
        </>
    );
    const base =
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground';
    // `link` → opens the shop's homepage. Not used inside result tiles: those are already <a>s and links can't nest.
    return link ? (
        <a
            href={info.homepage}
            target='_blank'
            rel='noopener noreferrer'
            title={`${info.label} — ${info.homepage.replace(/^https?:\/\//, '')}`}
            className={cn(
                base,
                'transition hover:border-primary/50 hover:text-primary',
                className
            )}
        >
            {content}
        </a>
    ) : (
        <span className={cn(base, className)}>{content}</span>
    );
}
