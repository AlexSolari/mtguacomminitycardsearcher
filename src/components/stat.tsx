import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A figure under a small label, as in the search summary and the order plan. `accent`: the one that matters most
// (the total).
export function Stat({
    label,
    accent,
    children
}: {
    label: string;
    accent?: boolean;
    children: ReactNode;
}) {
    return (
        <div className='flex flex-col gap-0.5'>
            <span className='text-xs uppercase tracking-wider text-muted-foreground'>
                {label}
            </span>
            <span
                className={cn(
                    'text-2xl font-semibold tabular-nums',
                    accent && 'text-primary'
                )}
            >
                {children}
            </span>
        </div>
    );
}

// Something the list is missing: a card short or not found, a shop whose search failed.
export function WarningChip({ children }: { children: ReactNode }) {
    return (
        <span className='rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs text-destructive'>
            {children}
        </span>
    );
}
