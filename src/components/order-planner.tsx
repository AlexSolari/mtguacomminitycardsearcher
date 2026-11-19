import { useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clickReporters } from '@/lib/report-click';
import { CARDS, plural } from '@/i18n';
import {
    filterResult,
    languageCounts,
    type OfferFilters as Filters
} from '@/filters';
import {
    planCards,
    planOptions,
    planOrder,
    shopsWithOffers,
    traderMatches,
    withoutShop,
    type PlanCard,
    type PlanLine,
    type PlanOption,
    type ShopOrder,
    type TraderMatch
} from '@/order-plan';
import { offerKey } from '@/results';
import type { CardResult } from '@/search-result';
import { SHOP_IDS, SHOP_INFO, type ShopId } from '@/shops';
import { isComplete, type SearchEntry } from '@/hooks/use-card-search';
import { TelegramIcon } from '@/components/icons';
import { OfferFilters } from '@/components/offer-filters';
import {
    Badge,
    FOIL_BADGE,
    formatPrice,
    PriceBlock,
    SellerDetails
} from '@/components/offer-parts';
import { ShopBadge } from '@/components/shop-badge';

const panel = 'rounded-2xl border bg-card/60 backdrop-blur';
const optionKey = (o: PlanOption) => [...o.shops].sort().join(',');

// The order plan: which shop to buy each card from, among the shops ticked in the shop filter, which it shares
// with the results (ticking a shop here ticks it there). The language and foil filters apply too: a plan for
// non-foil EN cards shouldn't buy a Japanese foil. Traders' lists are listed under it, outside the totals.
export function OrderPlanner({
    entries,
    filters,
    onFiltersChange,
    onClose
}: {
    entries: SearchEntry[];
    filters: Filters;
    onFiltersChange: (f: Filters) => void;
    onClose: () => void;
}) {
    // every shop's offers, filtered by finish and language only: the shops are the plan's to choose
    const filtered = useMemo(() => {
        const f = { ...filters, hiddenShops: [] };
        return entries.map((e) => ({
            ...e,
            result: e.result && filterResult(e.result, f)
        }));
    }, [entries, filters]);
    const cards = useMemo(() => planCards(filtered), [filtered]);
    const candidates = useMemo(
        () =>
            shopsWithOffers(
                cards,
                SHOP_IDS.filter((s) => !filters.hiddenShops.includes(s))
            ),
        [cards, filters.hiddenShops]
    );
    const options = useMemo(
        () => planOptions(cards, candidates),
        [cards, candidates]
    );
    // the row picked in the table; by default (or once the shops change and it's gone) the cheapest plan
    const [picked, setPicked] = useState<string | null>(null);
    const chosen =
        options.find((o) => optionKey(o) === picked) ?? options.at(-1);
    const plan = useMemo(
        () => planOrder(cards, new Set(chosen?.shops ?? [])),
        [cards, chosen]
    );
    const traders = useMemo(() => traderMatches(filtered), [filtered]);
    const shortCards = new Set(plan.short.map((s) => s.card));
    const searching = entries.some((e) => !isComplete(e));
    const fromPrice = plan.shops.some((s) => s.fromPrice);

    return (
        <div className='flex flex-col gap-4 animate-in fade-in duration-300'>
            <div className='flex flex-wrap items-center gap-3'>
                <button
                    type='button'
                    onClick={onClose}
                    className='inline-flex items-center gap-1.5 rounded-lg border bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur transition hover:text-foreground'
                >
                    <ArrowLeft className='size-3.5' />
                    До результатів
                </button>
                <h2 className='font-display text-xl font-semibold tracking-wide'>
                    Розподіл по магазинах
                </h2>
            </div>

            <OfferFilters
                filters={filters}
                onChange={onFiltersChange}
                languages={languageCounts(
                    entries.flatMap((e) => (e.result ? [e.result] : []))
                )}
                shops={SHOP_IDS.map((s) => [s, cardsAt(cards, s)])}
            />

            {searching && (
                <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                    <Loader2 className='size-3.5 animate-spin' />
                    Ще шукаємо: план зміниться, коли відповідять усі магазини.
                </div>
            )}

            <div className={cn(panel, 'grid grid-cols-3 gap-4 p-5')}>
                <Stat label='Сума'>
                    <span className='text-primary'>
                        {fromPrice && (
                            <span className='mr-1 text-sm font-normal text-muted-foreground'>
                                від
                            </span>
                        )}
                        {formatPrice(plan.total)}
                    </span>
                </Stat>
                <Stat label='Копій'>
                    {plan.copies} / {plan.wanted}
                </Stat>
                <Stat label='Магазинів'>{plan.shops.length}</Stat>
            </div>

            {options.length > 1 && (
                <OptionsTable
                    options={options}
                    chosen={chosen}
                    wanted={plan.wanted}
                    onPick={(o) => setPicked(optionKey(o))}
                />
            )}

            {plan.shops.map((order) => (
                <ShopOrderBlock
                    key={order.shop}
                    order={order}
                    without={
                        plan.shops.length > 1
                            ? withoutShop(cards, chosen!.shops, order.shop)
                            : undefined
                    }
                />
            ))}

            {plan.short.length > 0 && (
                <div className='flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm'>
                    <span className='text-muted-foreground'>
                        {plan.shops.length
                            ? 'Бракує в цих магазинах:'
                            : 'Немає в обраних магазинах:'}
                    </span>
                    {plan.short.map((s) => (
                        <span
                            key={s.card}
                            className='rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs text-destructive'
                        >
                            {s.card} · {s.copies} з {s.count}
                        </span>
                    ))}
                </div>
            )}

            {traders.length > 0 && (
                <TradersBlock traders={traders} shortCards={shortCards} />
            )}
        </div>
    );
}

// How many of the list's cards a shop has, for the shop menu.
const cardsAt = (cards: PlanCard[], shop: ShopId) =>
    cards.filter((c) => c.offers.some((o) => o.shop === shop)).length;

function Stat({
    label,
    children
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className='flex flex-col gap-0.5'>
            <span className='text-xs uppercase tracking-wider text-muted-foreground'>
                {label}
            </span>
            <span className='text-2xl font-semibold tabular-nums'>
                {children}
            </span>
        </div>
    );
}

// The best plan for each number of shops; picking a row shows that plan.
function OptionsTable({
    options,
    chosen,
    wanted,
    onPick
}: {
    options: PlanOption[];
    chosen: PlanOption | undefined;
    wanted: number;
    onPick: (o: PlanOption) => void;
}) {
    return (
        <div className={cn(panel, 'overflow-x-auto')}>
            <table className='w-full min-w-120 text-sm' role='radiogroup'>
                <caption className='px-4 pt-3 text-left text-xs text-muted-foreground'>
                    Найдешевший план для кожної кількості магазинів
                </caption>
                <thead>
                    <tr className='border-b text-left text-xs uppercase tracking-wider text-muted-foreground'>
                        <th className='py-2.5 pl-4 font-medium'>Магазинів</th>
                        <th className='px-3 py-2.5 font-medium'>Магазини</th>
                        <th className='px-3 py-2.5 text-right font-medium'>
                            Копій
                        </th>
                        <th className='py-2.5 pl-3 pr-4 text-right font-medium'>
                            Сума
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {options.map((o) => {
                        const on = o === chosen;
                        return (
                            <tr
                                key={optionKey(o)}
                                role='radio'
                                aria-checked={on}
                                tabIndex={0}
                                onClick={() => onPick(o)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        onPick(o);
                                    }
                                }}
                                className={cn(
                                    'cursor-pointer border-b transition-colors last:border-0 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    on && 'bg-primary/[0.09]'
                                )}
                            >
                                <td className='py-2 pl-4 font-semibold tabular-nums'>
                                    {o.shops.length}
                                </td>
                                <td className='px-3 py-2'>
                                    <div className='flex flex-wrap gap-x-3 gap-y-1'>
                                        {o.shops.map((s) => (
                                            <ShopBadge key={s} shop={s} />
                                        ))}
                                    </div>
                                </td>
                                <td
                                    className={cn(
                                        'px-3 py-2 text-right tabular-nums',
                                        o.copies < wanted && 'text-destructive'
                                    )}
                                >
                                    {o.copies} / {wanted}
                                </td>
                                <td
                                    className={cn(
                                        'py-2 pl-3 pr-4 text-right font-semibold tabular-nums',
                                        on && 'text-primary'
                                    )}
                                >
                                    {formatPrice(o.total)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// One shop's part of the plan: what to buy there and its subtotal. `without`: what leaving the shop out would
// change (copies the other shops lack, or the extra cost of buying them elsewhere).
function ShopOrderBlock({
    order,
    without
}: {
    order: ShopOrder;
    without?: { copies: number; total: number };
}) {
    return (
        <section className={cn(panel, 'flex flex-col')}>
            <header className='flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3'>
                <ShopBadge
                    shop={order.shop}
                    link
                    className='text-sm font-medium text-foreground'
                />
                <span className='text-xs text-muted-foreground tabular-nums'>
                    {order.copies} шт.
                </span>
                {without && (
                    <span className='text-xs text-muted-foreground'>
                        {without.copies > 0
                            ? `без нього бракуватиме ${without.copies} шт.`
                            : `без нього +${formatPrice(without.total)}`}
                    </span>
                )}
                <span className='ml-auto text-lg font-semibold tabular-nums'>
                    {order.fromPrice && (
                        <span className='mr-1 text-xs font-normal text-muted-foreground'>
                            від
                        </span>
                    )}
                    {formatPrice(order.subtotal)}
                </span>
            </header>
            <div className='overflow-x-auto'>
                <table className='w-full min-w-120 text-sm'>
                    <tbody>
                        {order.lines.map((line) => (
                            <PlanRow key={offerKey(line.offer)} line={line} />
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function OfferBadges({ offer }: { offer: CardResult }) {
    return (
        <span className='inline-flex flex-wrap items-center gap-1'>
            {offer.foil && (
                <Badge className={cn(FOIL_BADGE, 'shadow-none')}>FOIL</Badge>
            )}
            {offer.language && (
                <Badge
                    className='border border-border bg-transparent font-mono text-foreground shadow-none'
                    title='Мова'
                >
                    {offer.language}
                </Badge>
            )}
            {offer.condition && (
                <Badge
                    className='bg-sky-600/90 text-white shadow-none'
                    title='Стан'
                >
                    {offer.condition}
                </Badge>
            )}
        </span>
    );
}

function PlanRow({ line }: { line: PlanLine }) {
    const { card, offer, qty } = line;
    const report = clickReporters({
        shop: offer.shop,
        card,
        group: 'exact',
        view: 'plan',
        best: false,
        price: offer.price
    });
    return (
        <tr className='border-b last:border-0'>
            <td className='w-12 py-2 pl-4 font-semibold tabular-nums text-muted-foreground'>
                {qty}×
            </td>
            <td className='px-3 py-2'>
                <a
                    href={offer.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    onClick={report.onClick}
                    onAuxClick={report.onAuxClick}
                    className='group inline-flex items-center gap-1.5 font-medium hover:text-primary hover:underline'
                >
                    {card}
                    <ExternalLink className='size-3 opacity-50 group-hover:opacity-100' />
                </a>
                {offer.name !== card && (
                    <div className='text-xs text-muted-foreground'>
                        {offer.name}
                    </div>
                )}
            </td>
            <td className='px-3 py-2'>
                <OfferBadges offer={offer} />
            </td>
            <td className='px-3 py-2 text-right'>
                <PriceBlock link={offer} best={false} />
            </td>
            <td className='w-28 py-2 pl-3 pr-4 text-right font-semibold tabular-nums'>
                {qty > 1 && formatPrice(qty * offer.price!)}
            </td>
        </tr>
    );
}

// Traders who have cards of the list, the most cards first: a lead to message, not part of the plan.
function TradersBlock({
    traders,
    shortCards
}: {
    traders: TraderMatch[];
    shortCards: Set<string>;
}) {
    return (
        <section className='flex flex-col gap-3 pt-2'>
            <div className='flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground'>
                <span>Гравці</span>
                <span className='rounded-full bg-muted px-2 py-0.5 tabular-nums normal-case tracking-normal'>
                    {traders.length}
                </span>
                <span className='h-px flex-1 bg-border' />
            </div>
            <p className='text-xs text-muted-foreground'>
                Карти зі списків гравців, що є у вашому списку. Ціни TCGplayer
                для орієнтиру й не входять у суму: про ціну й угоду домовляйтеся
                з продавцем у Telegram.
            </p>
            {traders.map((t) => (
                <section
                    key={t.username}
                    className={cn(panel, 'flex flex-col')}
                >
                    <header className='flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3'>
                        <a
                            href={t.url}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='inline-flex items-center gap-1.5 text-sm font-medium hover:text-primary hover:underline'
                        >
                            <TelegramIcon className='size-4 text-sky-600 dark:text-sky-400' />
                            @{t.username}
                        </a>
                        <span className='text-xs text-muted-foreground'>
                            {t.name}
                        </span>
                        <span className='ml-auto text-xs text-muted-foreground'>
                            {plural(t.cards.length, CARDS)} зі списку
                        </span>
                    </header>
                    <div className='overflow-x-auto'>
                        <table className='w-full min-w-120 text-sm'>
                            <tbody>
                                {t.cards.flatMap(({ card, offers }) =>
                                    offers.map((offer) => (
                                        <TraderRow
                                            key={offerKey(offer)}
                                            card={card}
                                            offer={offer}
                                            missing={shortCards.has(card)}
                                        />
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>
            ))}
        </section>
    );
}

function TraderRow({
    card,
    offer,
    missing
}: {
    card: string;
    offer: CardResult;
    missing: boolean; // the shops in the plan lack it
}) {
    const report = clickReporters({
        shop: 'traders',
        card,
        group: 'traders',
        view: 'plan',
        best: false,
        price: null
    });
    return (
        <tr className='border-b last:border-0'>
            <td className='px-4 py-2'>
                <a
                    href={offer.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    onClick={report.onClick}
                    onAuxClick={report.onAuxClick}
                    className='font-medium hover:text-primary hover:underline'
                >
                    {offer.name}
                </a>
                <div>
                    <SellerDetails link={offer} />
                </div>
            </td>
            <td className='px-3 py-2'>
                <span className='inline-flex flex-wrap items-center gap-1'>
                    <OfferBadges offer={offer} />
                    {missing && (
                        <Badge className='bg-emerald-600 text-white shadow-none'>
                            бракує в магазинах
                        </Badge>
                    )}
                </span>
            </td>
            <td className='py-2 pl-3 pr-4 text-right'>
                <PriceBlock link={offer} best={false} />
            </td>
        </tr>
    );
}
