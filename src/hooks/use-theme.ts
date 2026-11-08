import { useEffect, useState } from 'react';
import {
    THEME_KEY,
    parseThemePreference,
    resolveTheme,
    type ThemePreference
} from '@/theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function loadPreference(): ThemePreference {
    try {
        return parseThemePreference(localStorage.getItem(THEME_KEY));
    } catch {
        return 'system';
    }
}

// The theme preference, remembered per browser. Applies it as the `dark` class on <html>,
// and while it is 'system', follows the OS switching between light and dark.
export function useTheme() {
    const [preference, setPreference] =
        useState<ThemePreference>(loadPreference);

    useEffect(() => {
        const media = matchMedia(DARK_QUERY);
        const apply = () =>
            document.documentElement.classList.toggle(
                'dark',
                resolveTheme(preference, media.matches) === 'dark'
            );
        apply();
        if (preference !== 'system') return;
        media.addEventListener('change', apply);
        return () => media.removeEventListener('change', apply);
    }, [preference]);

    const changePreference = (next: ThemePreference) => {
        setPreference(next);
        try {
            if (next === 'system') localStorage.removeItem(THEME_KEY);
            else localStorage.setItem(THEME_KEY, next);
        } catch {} // private mode / blocked storage — the choice just won't persist
    };

    return [preference, changePreference] as const;
}
