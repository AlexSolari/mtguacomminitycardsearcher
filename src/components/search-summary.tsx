import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CARDS, plural } from '@/i18n';
import { cheapestCopies, splitMatches } from '@/results';
import { SHOP_INFO, type ShopId } from '@/shops';
import type { SearchEntry } from '@/hooks/use-card-search';
import { formatPrice } from '@/components/offer-parts';

function Stat({
    label,
    value,
    accent
}: {
    label: string;
    value: React.ReactNode;
    accent?: boolean;
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
                {value}
            </span>
        </div>
    );
}

// Live totals over the cards searched so far. The minimum sum counts only exact matches, for as many copies as
// the list asks for (within shop stock). Fuzzy matches, Art Series and auctions are left out: they aren't
// the card, or have no fixed price.
export function SearchSummary({ entries }: { entries: SearchEntry[] }) {
    let finished = 0;
    let found = 0;
    let offers = 0;
    let total = 0;
    const missing: string[] = []; // no exact match, and every shop answered
    const short: { card: string; copies: number; count: number }[] = [];
    // shop → number of cards whose search failed there
    const failedShops = new Map<ShopId, number>();
    for (const { card, count, result } of entries) {
        if (!result) continue;
        finished++;
        offers += result.links.length;
        for (const e of result.errors)
            if (e.shop)
                failedShops.set(e.shop, (failedShops.get(e.shop) ?? 0) + 1);

        const { exact } = splitMatches(result);
        if (exact.length === 0) {
            if (result.errors.length === 0) missing.push(card);
            continue;
        }
        found++;
        const { cost, copies } = cheapestCopies(exact, count);
        total += cost;
        if (copies < count) short.push({ card, copies, count });
    }
    const remaining = entries.length - finished;

    return (
        <div className='flex flex-col gap-4 rounded-2xl border bg-card/60 p-5 backdrop-blur animate-in fade-in duration-500'>
            <div className='grid grid-cols-3 gap-4'>
                <Stat label='Знайдено' value={`${found} / ${entries.length}`} />
                <Stat label='Пропозиції' value={offers} />
                <Stat
                    label='Мінімальна сума'
                    value={formatPrice(total)}
                    accent
                />
            </div>
            {remaining > 0 && (
                <div className='flex flex-col gap-2'>
                    <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                        <Loader2 className='size-3.5 animate-spin' />
                        Шукаємо ще {plural(remaining, CARDS)}…
                    </div>
                    <div className='h-1 overflow-hidden rounded-full bg-muted'>
                        <div
                            className='h-full rounded-full bg-primary transition-[width] duration-500 ease-out'
                            style={{
                                width: `${(finished / entries.length) * 100}%`
                            }}
                        />
                    </div>
                </div>
            )}
            {failedShops.size > 0 && (
                <div className='flex flex-wrap items-center gap-2 border-t pt-4 text-sm'>
                    <AlertTriangle className='size-4 shrink-0 text-destructive' />
                    <span className='text-muted-foreground'>
                        Пошук не вдався в магазинах:
                    </span>
                    {[...failedShops].map(([shop, count]) => (
                        <Chip key={shop}>
                            {SHOP_INFO[shop].label} · {plural(count, CARDS)}
                        </Chip>
                    ))}
                </div>
            )}
            {short.length > 0 && (
                <div className='flex flex-wrap items-center gap-2 border-t pt-4 text-sm'>
                    <span className='text-muted-foreground'>
                        Недостатньо в наявності:
                    </span>
                    {short.map((s) => (
                        <Chip key={s.card}>
                            {s.card} · {s.copies} з {s.count}
                        </Chip>
                    ))}
                </div>
            )}
            {missing.length > 0 && (
                <div className='flex flex-wrap items-center gap-2 border-t pt-4 text-sm'>
                    <span className='text-muted-foreground'>
                        Немає точних збігів:
                    </span>
                    {missing.map((card) => (
                        <Chip key={card}>{card}</Chip>
                    ))}
                </div>
            )}
        </div>
    );
}

function Chip({ children }: { children: React.ReactNode }) {
    return (
        <span className='rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs text-destructive'>
            {children}
        </span>
    );
}
