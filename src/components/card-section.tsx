import { Fragment, memo, useId, useState } from 'react';
import { AlertTriangle, ChevronRight, Loader2, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OFFERS, plural } from '@/i18n';
import { offerKey, splitMatches } from '@/results';
import type { CardResult, SearchError, SearchResult } from '@/search-result';
import { manualSearchUrl, SHOP_INFO } from '@/shops';
import { formatPrice } from '@/components/offer-parts';
import { ResultTable } from '@/components/result-table';
import { ManualCheckTile, ResultTile } from '@/components/result-tile';
import type { ResultsView } from '@/components/view-toggle';

const describeError = (e: SearchError) =>
    e.shop
        ? `Пошук у ${SHOP_INFO[e.shop].label} не вдався (${e.message})`
        : `Не вдалося виконати пошук: ${e.message}`;

// `typed`: the name as entered, when the server corrected it to `title`
// `status`: shop errors and shops still searching, in the row's free space between the title and the price
function SectionHeader({
    title,
    typed,
    count,
    status,
    children
}: {
    title: string;
    typed?: string;
    count: number;
    status?: React.ReactNode;
    children?: React.ReactNode;
}) {
    return (
        <div className='flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b pb-3'>
            <div className='flex flex-col'>
                <h2 className='font-display text-xl font-semibold tracking-wide'>
                    {title}
                    {count > 1 && (
                        <span className='ml-2 text-base text-muted-foreground tabular-nums'>
                            ×{count}
                        </span>
                    )}
                </h2>
                {typed && (
                    <span className='text-xs text-muted-foreground'>
                        Виправлено з «{typed}»
                    </span>
                )}
            </div>
            <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2 self-center'>
                {status}
            </div>
            <div className='flex items-center gap-3 text-sm text-muted-foreground'>
                {children}
            </div>
        </div>
    );
}

const grid = 'grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4';

// With `expanded` + `onToggle`, the divider is a button that shows/hides its group.
function GroupDivider({
    label,
    count,
    expanded,
    onToggle,
    controls
}: {
    label: string;
    count: number;
    expanded?: boolean;
    onToggle?: () => void;
    controls?: string;
}) {
    const content = (
        <>
            {onToggle && (
                <ChevronRight
                    className={cn(
                        'size-3.5 shrink-0 transition-transform duration-200',
                        expanded && 'rotate-90'
                    )}
                />
            )}
            <span>{label}</span>
            <span className='rounded-full bg-muted px-2 py-0.5 tabular-nums normal-case tracking-normal'>
                {count}
            </span>
            <span className='h-px flex-1 bg-border' />
        </>
    );
    const base =
        'flex items-center gap-3 pt-2 text-xs uppercase tracking-wider text-muted-foreground';
    return onToggle ? (
        <button
            type='button'
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={controls}
            className={cn(
                base,
                'w-full cursor-pointer rounded-sm text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
        >
            {content}
        </button>
    ) : (
        <div className={base}>{content}</div>
    );
}

// Memoized: the page re-renders on every keystroke in the card list, and a big deck can have
// thousands of tiles on screen. A section only needs to re-render when its result or the view changes.
export const CardSection = memo(function CardSection({
    result,
    count,
    view = 'grid'
}: {
    result: SearchResult;
    count: number; // copies wanted
    view?: ResultsView;
}) {
    const { exact, auctions, art, other, pricing, min } = splitMatches(result);
    const links = result.links;
    const isBest = (link: CardResult) =>
        links.length > 1 &&
        pricing.has(link) &&
        link.price !== null &&
        link.price === min;
    const hasExact = exact.length > 0;
    // Secondary groups — fuzzy "other matches" ("The Walls of Ba Sing Se" for "Ba Sing Se") and Art Series — are
    // dimmed and start collapsed, but only when something better is shown above them; otherwise they're the result.
    const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
        () => new Set()
    );
    const toggleGroup = (key: string) =>
        setOpenGroups((prev) => {
            const next = new Set(prev);
            if (!next.delete(key)) next.add(key);
            return next;
        });
    const idPrefix = useId();
    const manualChecks = result.errors.flatMap((err) => {
        const url = manualSearchUrl(err, result.card);
        return url && err.shop ? [{ shop: err.shop, url }] : [];
    });
    const groups = [
        { key: 'exact' as const, label: null, links: exact, secondary: false },
        {
            key: 'auctions' as const,
            label: 'Аукціони',
            links: auctions,
            secondary: false
        },
        {
            key: 'other' as const,
            label: hasExact
                ? 'Інші збіги'
                : 'Точних збігів немає · схожі назви',
            links: other,
            secondary: hasExact
        },
        {
            key: 'art' as const,
            label: 'Art Series',
            links: art,
            secondary: hasExact || other.length > 0
        }
    ].map((group) => ({
        ...group,
        dim: group.secondary,
        collapse: group.secondary
            ? {
                  open: openGroups.has(group.key),
                  toggle: () => toggleGroup(group.key)
              }
            : undefined
    }));

    return (
        <section className='flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500'>
            <SectionHeader
                title={result.card}
                typed={result.typed}
                count={count}
                status={
                    <>
                        {result.errors.map((err) => (
                            <span
                                key={err.shop ?? 'request'}
                                className='inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs text-destructive'
                            >
                                <AlertTriangle className='size-3.5 shrink-0' />
                                {describeError(err)}
                            </span>
                        ))}
                        {result.pending?.length ? (
                            <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground'>
                                <Loader2 className='size-3.5 shrink-0 animate-spin' />
                                Ще шукаємо в{' '}
                                {result.pending
                                    .map((s) => SHOP_INFO[s].label)
                                    .join(', ')}
                                …
                            </span>
                        ) : null}
                    </>
                }
            >
                {min !== null && (
                    <span>
                        від{' '}
                        <span className='font-semibold text-primary tabular-nums'>
                            {formatPrice(min)}
                        </span>
                    </span>
                )}
                <span className='rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums'>
                    {plural(links.length, OFFERS)}
                </span>
            </SectionHeader>

            {links.length === 0
                ? result.errors.length === 0 &&
                  !result.pending?.length && (
                      <div className='flex items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground'>
                          <SearchX className='size-5 shrink-0' />
                          Не знайдено в жодному магазині.
                      </div>
                  )
                : groups.map(
                      (group) =>
                          group.links.length > 0 && (
                              <Fragment key={group.key}>
                                  {group.label && (
                                      <GroupDivider
                                          label={group.label}
                                          count={group.links.length}
                                          expanded={group.collapse?.open}
                                          onToggle={group.collapse?.toggle}
                                          controls={`${idPrefix}-${group.key}`}
                                      />
                                  )}
                                  {group.collapse &&
                                  !group.collapse.open ? null : view ===
                                    'table' ? (
                                      <div
                                          id={`${idPrefix}-${group.key}`}
                                          className={cn(
                                              group.dim &&
                                                  'opacity-70 transition-opacity hover:opacity-100'
                                          )}
                                      >
                                          <ResultTable
                                              links={group.links}
                                              isBest={isBest}
                                              card={result.card}
                                              group={group.key}
                                          />
                                      </div>
                                  ) : (
                                      <div
                                          id={`${idPrefix}-${group.key}`}
                                          className={cn(
                                              grid,
                                              group.dim &&
                                                  'opacity-70 transition-opacity hover:opacity-100'
                                          )}
                                      >
                                          {group.links.map((link) => (
                                              <ResultTile
                                                  key={offerKey(link)}
                                                  link={link}
                                                  best={isBest(link)}
                                                  card={result.card}
                                                  group={group.key}
                                              />
                                          ))}
                                      </div>
                                  )}
                              </Fragment>
                          )
                  )}

            {manualChecks.length > 0 && (
                <>
                    <GroupDivider
                        label='Перевірте вручну'
                        count={manualChecks.length}
                    />
                    <div className={grid}>
                        {manualChecks.map((m) => (
                            <ManualCheckTile
                                key={m.shop}
                                shop={m.shop}
                                card={result.card}
                                url={m.url}
                            />
                        ))}
                    </div>
                </>
            )}
        </section>
    );
});

export function CardSectionSkeleton({
    name,
    count
}: {
    name: string;
    count: number;
}) {
    return (
        <section className='flex flex-col gap-4'>
            <SectionHeader title={name} count={count}>
                <Loader2 className='size-4 animate-spin' />
            </SectionHeader>
            <div className={grid}>
                {Array.from({ length: 4 }, (_, i) => (
                    <div
                        key={i}
                        className='flex flex-col gap-3 rounded-xl border bg-card/40 p-2'
                        style={{ animationDelay: `${i * 120}ms` }}
                    >
                        <div className='aspect-488/680 animate-pulse rounded-lg bg-muted' />
                        <div className='h-3.5 w-3/4 animate-pulse rounded bg-muted' />
                        <div className='mb-1 h-3 w-1/2 animate-pulse rounded bg-muted' />
                    </div>
                ))}
            </div>
        </section>
    );
}

// Cards no shop has, gathered into one block at the bottom instead of a section each.
export function NotFoundSection({
    entries
}: {
    entries: { id: string; card: string; count: number; typed?: string }[];
}) {
    return (
        <section className='flex flex-col gap-3 rounded-xl border border-dashed px-4 py-4 animate-in fade-in duration-500'>
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <SearchX className='size-4 shrink-0' />
                Не знайдено в жодному магазині
                <span className='rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums'>
                    {entries.length}
                </span>
            </div>
            <ul className='flex flex-wrap gap-2'>
                {entries.map((e) => (
                    <li
                        key={e.id}
                        title={
                            e.typed ? `Виправлено з «${e.typed}»` : undefined
                        }
                        className='rounded-full border bg-muted/40 px-3 py-1 text-sm'
                    >
                        {e.card}
                        {e.count > 1 && (
                            <span className='ml-1.5 text-muted-foreground tabular-nums'>
                                ×{e.count}
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}
