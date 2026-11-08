import { describe, expect, test } from 'bun:test';
import { parseThemePreference, resolveTheme } from '@/theme';

describe('parseThemePreference', () => {
    test('keeps an explicit choice', () => {
        expect(parseThemePreference('light')).toBe('light');
        expect(parseThemePreference('dark')).toBe('dark');
    });

    test('falls back to system for missing or unknown values', () => {
        expect(parseThemePreference(null)).toBe('system');
        expect(parseThemePreference('system')).toBe('system');
        expect(parseThemePreference('Dark')).toBe('system');
        expect(parseThemePreference('')).toBe('system');
    });
});

describe('resolveTheme', () => {
    test('an explicit choice wins over the OS setting', () => {
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
    });

    test('system follows the OS setting', () => {
        expect(resolveTheme('system', true)).toBe('dark');
        expect(resolveTheme('system', false)).toBe('light');
    });
});
