// Light/dark theme: the visitor picks one, or follows the OS ('system', the default).
// The inline script in index.html repeats this logic before first paint; keep the two in sync.
export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'searcher:theme';

// Anything other than an explicit choice (nothing stored, an old or garbled value) means "follow the OS".
export function parseThemePreference(raw: string | null): ThemePreference {
    return raw === 'light' || raw === 'dark' ? raw : 'system';
}

export function resolveTheme(
    preference: ThemePreference,
    systemPrefersDark: boolean
): Theme {
    if (preference !== 'system') return preference;
    return systemPrefersDark ? 'dark' : 'light';
}
