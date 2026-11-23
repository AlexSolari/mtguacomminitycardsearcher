// An offer's badges, the same in the table, the tiles and the order plan.
import { cn } from '@/lib/utils';
import { TelegramIcon } from '@/components/icons';
import type { CardResult } from '@/shared/search-result';

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

const FOIL_BADGE =
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
