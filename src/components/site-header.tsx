import { Sparkles } from 'lucide-react';
import { ShopBadge } from '@/components/shop-badge';
import { useGreasefangEasterEgg } from '@/components/greasefang-easter-egg';
import { SHOP_INFO, type ShopId } from '@/shops';

// `onTitleClick` reopens the card list, so the title doubles as a "back to the search" button.
export function SiteHeader({ onTitleClick }: { onTitleClick: () => void }) {
    const easterEgg = useGreasefangEasterEgg();
    return (
        <header className='flex flex-col items-center gap-3 text-center'>
            <div className='flex items-center justify-center gap-3'>
                {/* click → Greasefang easter egg; hovering warms up the card images first */}
                <div
                    onClick={easterEgg.play}
                    onPointerEnter={easterEgg.preload}
                    className='grid size-11 place-items-center rounded-xl bg-linear-to-br from-primary to-amber-600 text-primary-foreground shadow-lg shadow-primary/20 motion-safe:hover:animate-shake'
                >
                    <Sparkles className='size-5' />
                </div>
                <h1 className='font-display text-2xl font-bold leading-tight tracking-wide sm:text-3xl lg:text-4xl'>
                    <button
                        type='button'
                        onClick={onTitleClick}
                        title='Змінити список карт'
                        aria-controls='card-list-form'
                        className='cursor-pointer rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50'
                    >
                        MTG UA Community{' '}
                        <span className='text-primary'>Card Searcher</span>
                    </button>
                </h1>
            </div>
            <p className='flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-muted-foreground'>
                Порівнюємо ціни в магазинах
                {(Object.keys(SHOP_INFO) as ShopId[]).map((shop) => (
                    <ShopBadge
                        key={shop}
                        shop={shop}
                        link
                        className='rounded-full border bg-card/60 px-2.5 py-1 text-foreground'
                    />
                ))}
            </p>
            {easterEgg.show}
        </header>
    );
}
