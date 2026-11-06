import { useRef, useState } from 'react';
import './greasefang-easter-egg.css';

// Easter egg behind the header logo: Greasefang, Okiba Boss crews Parhelion II, which makes two Angels
// and flies off with them. The timeline lives in greasefang-easter-egg.css.
const IMAGES = {
    greasefang:
        'https://cards.scryfall.io/normal/front/5/6/56a0d43b-4d38-40a7-be6c-8324ab3bf773.jpg',
    parhelion:
        'https://cards.scryfall.io/normal/front/8/7/871279e6-9a59-470e-8acc-fd5fe4fda5b3.jpg',
    angel: 'https://cards.scryfall.io/normal/front/b/b/bb2b69c0-ba32-4db1-bf02-230b6d4802aa.jpg'
};

const DURATION_MS = 6300; // last step (Greasefang fading out) ends at 6.1s
const LOAD_TIMEOUT_MS = 3000; // play anyway if Scryfall is slow

// Started once (first hover or click) and reused; failed images just show as blanks in the animation.
let imagesLoaded: Promise<unknown> | null = null;
const loadImages = () =>
    (imagesLoaded ??= Promise.all(
        Object.values(IMAGES).map((src) => {
            const img = new Image();
            img.src = src;
            return img.decode().catch(() => {});
        })
    ));
const waitForImages = () =>
    Promise.race([
        loadImages(),
        new Promise((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS))
    ]);

// `play` starts the show (ignored while it's running or loading); `preload` warms the images up, e.g. on hover.
export function useGreasefangEasterEgg() {
    const [playing, setPlaying] = useState(false);
    const busy = useRef(false);

    const play = async () => {
        if (busy.current) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        busy.current = true;
        await waitForImages();
        setPlaying(true);
        setTimeout(() => {
            setPlaying(false);
            busy.current = false;
        }, DURATION_MS);
    };

    const show = playing ? <GreasefangEasterEgg /> : null;
    return { play, preload: loadImages, show };
}

function GreasefangEasterEgg() {
    return (
        <div className='egg-stage' aria-hidden='true'>
            <div className='egg-greasefang'>
                <img className='egg-card' src={IMAGES.greasefang} alt='' />
            </div>
            <div className='egg-squadron'>
                <div className='egg-parhelion'>
                    <img className='egg-card' src={IMAGES.parhelion} alt='' />
                </div>
                <div className='egg-angel egg-angel-left'>
                    <img className='egg-card' src={IMAGES.angel} alt='' />
                </div>
                <div className='egg-angel egg-angel-right'>
                    <img className='egg-card' src={IMAGES.angel} alt='' />
                </div>
            </div>
        </div>
    );
}
