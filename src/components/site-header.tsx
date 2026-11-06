import { Sparkles } from 'lucide-react';
import { ShopBadge } from '@/components/search-results';
import { useGreasefangEasterEgg } from '@/components/greasefang-easter-egg';
import { SHOP_INFO, type ShopId } from '@/shops';

export function SiteHeader() {
    const easterEgg = useGreasefangEasterEgg();
    return (
        <header className='flex flex-col gap-3'>
            <div className='flex items-center gap-3'>
                {/* click → Greasefang easter egg; hovering warms up the card images first */}
                <div
                    onClick={easterEgg.play}
                    onPointerEnter={easterEgg.preload}
                    className='grid size-11 place-items-center rounded-xl bg-linear-to-br from-primary to-amber-600 text-primary-foreground shadow-lg shadow-primary/20 motion-safe:hover:animate-shake'
                >
                    <Sparkles className='size-5' />
                </div>
                <h1 className='font-display text-2xl font-bold leading-tight tracking-wide sm:text-3xl lg:text-4xl'>
                    MTG UA Community{' '}
                    <span className='text-primary'>Card Searcher</span>
                </h1>
            </div>
            <p className='flex flex-wrap items-center gap-x-3 gap-y-2 text-muted-foreground'>
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
