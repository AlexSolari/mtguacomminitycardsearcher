import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNearViewport } from '@/hooks/use-near-viewport';

// A card's image, loaded once it's near the viewport; its name in place of an image that's missing or fails.
export function CardImage({
    src,
    alt,
    className
}: {
    src: string | null;
    alt: string;
    className?: string;
}) {
    const [failed, setFailed] = useState(false);
    const [placeholder, near] = useNearViewport<HTMLDivElement>();
    if (src && !failed && !near) {
        // the card's bg-muted frame shows until the image is close enough to load
        return <div ref={placeholder} className='size-full' />;
    }
    if (!src || failed) {
        return (
            <div className='flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground'>
                <ImageOff className='size-6 opacity-60' />
                {alt}
            </div>
        );
    }
    return (
        <img
            src={src}
            alt={alt}
            onError={() => setFailed(true)}
            className={cn(
                'size-full rounded-[4.75%/3.5%] object-cover transition duration-500 ease-out group-hover:scale-[1.04]',
                className
            )}
        />
    );
}
