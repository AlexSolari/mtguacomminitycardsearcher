import { useEffect, useId, useRef, useState } from 'react';
import {
    Check,
    ChevronDown,
    ClipboardList,
    Languages,
    Store,
    X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    isFiltering,
    NO_FILTERS,
    type FoilFilter,
    type OfferFilters as Filters
} from '@/filters';
import { SHOP_INFO, type ShopId } from '@/shops';

const group =
    'inline-flex items-center rounded-lg border bg-card/60 p-0.5 backdrop-blur';

// MTG players say "foil" in Ukrainian too; the tiles' badge reads FOIL
const FOIL_OPTIONS: { value: FoilFilter; label: string }[] = [
    { value: 'any', label: 'Усі' },
    { value: 'nonfoil', label: 'Non-foil' },
    { value: 'foil', label: 'Foil' }
];

// The bar above the results and the order plan: finish, language and shop. `languages` and `shops` are what the
// results have, with counts, so the choices fit the search. With `onPlan`, the shop menu carries the button that
// opens the order plan: the shops ticked are the ones it orders from.
export function OfferFilters({
    filters,
    onChange,
    languages,
    shops,
    onPlan
}: {
    filters: Filters;
    onChange: (f: Filters) => void;
    languages: [string, number][];
    shops: [ShopId, number][];
    onPlan?: () => void;
}) {
    const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
    // A hidden language the current results lack stays in the menu, so it can be shown again.
    const languageItems = [
        ...languages,
        ...filters.hiddenLanguages
            .filter((l) => !languages.some(([code]) => code === l))
            .map((l): [string, number] => [l, 0])
    ].map(([code, count]) => ({ id: code, label: code, count }));

    return (
        <div className='flex flex-wrap items-center gap-2'>
            <div role='radiogroup' aria-label='Фольга' className={group}>
                {FOIL_OPTIONS.map(({ value, label }) => (
                    <button
                        key={value}
                        type='button'
                        role='radio'
                        aria-checked={filters.foil === value}
                        onClick={() => set({ foil: value })}
                        className={cn(
                            'inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium transition',
                            filters.foil === value
                                ? 'bg-primary-fill text-primary-foreground shadow'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* one language is no choice; the menu shows once a search has more, or while one is hidden */}
            {languageItems.length > 1 && (
                <CheckMenu
                    label='Мова'
                    icon={Languages}
                    items={languageItems}
                    hidden={filters.hiddenLanguages}
                    onChange={(hiddenLanguages) => set({ hiddenLanguages })}
                />
            )}

            <div className='flex'>
                <CheckMenu
                    label='Магазини'
                    icon={Store}
                    items={shops.map(([shop, count]) => ({
                        id: shop,
                        label: SHOP_INFO[shop].label,
                        icon: SHOP_INFO[shop].icon,
                        count
                    }))}
                    hidden={filters.hiddenShops}
                    onChange={(hiddenShops) => set({ hiddenShops })}
                    joined={!!onPlan}
                />
                {onPlan && (
                    <button
                        type='button'
                        onClick={onPlan}
                        className='inline-flex items-center gap-1.5 rounded-r-lg border border-primary/50 bg-primary-fill px-3 py-1.5 text-xs font-medium text-primary-foreground shadow transition hover:brightness-110'
                    >
                        <ClipboardList className='size-3.5' />
                        Розподіл по магазинах
                    </button>
                )}
            </div>

            {isFiltering(filters) && (
                <button
                    type='button'
                    onClick={() => onChange(NO_FILTERS)}
                    className='inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition hover:text-foreground'
                >
                    <X className='size-3.5' />
                    Скинути
                </button>
            )}
        </div>
    );
}

// A button opening a checklist (checked = shown), with each item's count; closes on a click outside or Escape.
// The button reads "shown/total" while anything is hidden. `joined`: a button follows it, attached on the right.
function CheckMenu<T extends string>({
    label,
    icon: Icon,
    items,
    hidden,
    onChange,
    joined
}: {
    label: string;
    icon: typeof Store;
    items: { id: T; label: string; icon?: string; count: number }[];
    hidden: T[];
    onChange: (hidden: T[]) => void;
    joined?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const menuId = useId();

    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            setOpen(false);
            button.current?.focus();
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // Only this menu's items count, and the rest stay hidden whatever is picked here: the order plan's shop menu
    // shares the filters with the results' but leaves out "Гравці", whose hiding isn't this menu's to show or undo.
    const hiddenHere = hidden.filter((h) => items.some((i) => i.id === h));
    const hiddenElsewhere = hidden.filter((h) => !hiddenHere.includes(h));
    const toggle = (id: T) =>
        onChange(
            hidden.includes(id)
                ? hidden.filter((h) => h !== id)
                : [...hidden, id]
        );
    const shown = items.length - hiddenHere.length;

    return (
        <div ref={root} className='relative'>
            <button
                ref={button}
                type='button'
                aria-expanded={open}
                aria-controls={menuId}
                onClick={() => setOpen(!open)}
                className={cn(
                    group,
                    'gap-1.5 px-3 py-1.5 text-xs font-medium transition',
                    joined && 'rounded-r-none border-r-0',
                    hiddenHere.length
                        ? 'border-primary/50 text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                )}
            >
                <Icon className='size-3.5' />
                {label}
                {hiddenHere.length > 0 && (
                    <span className='tabular-nums'>
                        {shown}/{items.length}
                    </span>
                )}
                <ChevronDown
                    className={cn(
                        'size-3.5 transition-transform',
                        open && 'rotate-180'
                    )}
                />
            </button>
            {open && (
                <div
                    id={menuId}
                    role='group'
                    aria-label={label}
                    className='absolute left-0 top-full z-30 mt-1 flex w-60 flex-col rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in zoom-in-95 duration-150'
                >
                    {items.map((item) => {
                        const on = !hidden.includes(item.id);
                        return (
                            <button
                                key={item.id}
                                type='button'
                                role='checkbox'
                                aria-checked={on}
                                onClick={() => toggle(item.id)}
                                className={cn(
                                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-accent',
                                    !on && 'text-muted-foreground'
                                )}
                            >
                                <span
                                    className={cn(
                                        'flex size-4 shrink-0 items-center justify-center rounded-sm border',
                                        on &&
                                            'border-primary-fill bg-primary-fill text-primary-foreground'
                                    )}
                                >
                                    {on && <Check className='size-3' />}
                                </span>
                                {item.icon && (
                                    <img
                                        src={item.icon}
                                        alt=''
                                        className='size-4 rounded-sm bg-foreground/5'
                                        loading='lazy'
                                    />
                                )}
                                <span className='flex-1 truncate'>
                                    {item.label}
                                </span>
                                <span className='text-xs tabular-nums text-muted-foreground'>
                                    {item.count}
                                </span>
                            </button>
                        );
                    })}
                    {hiddenHere.length > 0 && (
                        <button
                            type='button'
                            onClick={() => onChange(hiddenElsewhere)}
                            className='mt-1 rounded-md border-t px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground'
                        >
                            Показати всі
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
