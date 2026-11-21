import { AlertTriangle, Loader2 } from 'lucide-react';
import { CARDS, plural } from '@/i18n';
import { summarize } from '@/results';
import { SHOP_INFO } from '@/shops';
import type { SearchEntry } from '@/hooks/use-card-search';
import { formatPrice } from '@/components/offer-parts';
import { Stat, WarningChip } from '@/components/stat';

// Live totals over the cards searched so far (see summarize in results.ts). `entries` are already filtered, so
// every figure is for the offers shown.
export function SearchSummary({
    entries,
    filtered
}: {
    entries: SearchEntry[];
    filtered?: boolean; // the filters are on
}) {
    const {
        cards,
        finished,
        found,
        offers,
        total,
        missing,
        short,
        failedShops
    } = summarize(entries);
    const remaining = cards - finished;

    return (
        <div className='flex flex-col gap-4 rounded-2xl border bg-card/60 p-5 backdrop-blur animate-in fade-in duration-500'>
            <div className='grid grid-cols-3 gap-4'>
                <Stat label='Знайдено'>
                    {found} / {cards}
                </Stat>
                <Stat label='Пропозиції'>{offers}</Stat>
                <Stat label='Мінімальна сума' accent>
                    {formatPrice(total)}
                </Stat>
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
                                width: `${(finished / cards) * 100}%`
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
                        <WarningChip key={shop}>
                            {SHOP_INFO[shop].label} · {plural(count, CARDS)}
                        </WarningChip>
                    ))}
                </div>
            )}
            {short.length > 0 && (
                <div className='flex flex-wrap items-center gap-2 border-t pt-4 text-sm'>
                    <span className='text-muted-foreground'>
                        Недостатньо в наявності:
                    </span>
                    {short.map((s) => (
                        <WarningChip key={s.card}>
                            {s.card} · {s.copies} з {s.count}
                        </WarningChip>
                    ))}
                </div>
            )}
            {missing.length > 0 && (
                <div className='flex flex-wrap items-center gap-2 border-t pt-4 text-sm'>
                    <span className='text-muted-foreground'>
                        {filtered
                            ? 'Немає точних збігів з цими фільтрами:'
                            : 'Немає точних збігів:'}
                    </span>
                    {missing.map((card) => (
                        <WarningChip key={card}>{card}</WarningChip>
                    ))}
                </div>
            )}
        </div>
    );
}
