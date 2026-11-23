import { ART_SERIES } from '@/shared/matching';

export const decodeEntities = (s: string) =>
    s
        .replace(/&quot;/g, '"')
        .replace(/&mdash;/g, '—')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => codePoint(Number(dec)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

// "Sol Ring — Commander Masters #1, Etched": a card's name with its edition after " — ", where isExactMatch cuts,
// the shape every shop's listing takes. `set` and `number` make its first part ("Commander Masters #1"), and
// `details` (finishes, treatments: "Etched", "Showcase") follow, comma-separated. Empty parts are left out; with no
// edition at all, the name is as it is.
export function withEdition(
    name: string,
    set: string | null | undefined,
    number?: string | number | null,
    ...details: (string | false | null | undefined)[]
): string {
    const printing = [set, number ? `#${number}` : null]
        .filter(Boolean)
        .join(' ');
    const edition = [printing, ...details].filter(Boolean).join(', ');
    return edition ? `${name} — ${edition}` : name;
}

// "etched" → "Etched", for finishes and treatments a shop gives in lower case
export const capitalize = (s: string) => s && s[0]!.toUpperCase() + s.slice(1);

// Whether a printing's set is an Art Series one (see isArtSeries), for a shop that gives the set's name.
export const isArtSeriesSet = (setName: string | null | undefined) =>
    ART_SERIES.test(setName ?? '');

// out-of-range numeric entities would make String.fromCodePoint throw
const codePoint = (n: number) =>
    n <= 0x10ffff ? String.fromCodePoint(n) : '�';

// Every price goes through here. A price in UAH from a JSON number or a decimal string (Nerdik's "183.00");
// anything else (null, "", "—", NaN) is unknown: null. So is 0 or less, which no shop charges: a 0 would win best
// price. Never Number(...) alone, which turns null and "" into 0.
// Formatted text isn't read ("1 234 ₴" → null): no shop gives prices that way today.
export const toPrice = (value: unknown): number | null => {
    const n =
        typeof value === 'number' || typeof value === 'string'
            ? Number(value)
            : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
};

// `path` resolved against the shop's `base`; null without one, or for one that isn't a URL ("http://[" makes URL
// throw), so one odd link from a shop can't fail the whole parse.
export function abs(base: string, path: string | undefined): string | null {
    if (!path) return null;
    try {
        return new URL(decodeEntities(path), base).href;
    } catch {
        return null;
    }
}

// A field of a shop's JSON that should be a string: it, or undefined when it's anything else.
export const asString = (value: unknown) =>
    typeof value === 'string' ? value : undefined;

// Some shops spell languages out; normalise to codes for the badge.
const LANGUAGE_CODES: Record<string, string> = {
    english: 'EN',
    russian: 'RU',
    japanese: 'JA',
    german: 'DE',
    french: 'FR',
    italian: 'IT',
    spanish: 'ES',
    portuguese: 'PT',
    korean: 'KO',
    chinese: 'ZH',
    'simplified chinese': 'ZHS',
    'traditional chinese': 'ZHT',
    ukrainian: 'UK',
    // CartOn's, in Ukrainian
    англійська: 'EN',
    російська: 'RU',
    японська: 'JA',
    німецька: 'DE',
    французька: 'FR',
    італійська: 'IT',
    іспанська: 'ES',
    португальська: 'PT',
    корейська: 'KO',
    китайська: 'ZH',
    українська: 'UK'
};
export const languageCode = (s: string | null | undefined) => {
    if (!s) return undefined;
    const t = s.trim();
    return (
        LANGUAGE_CODES[t.toLowerCase()] ??
        (t.length <= 3 ? t.toUpperCase() : undefined)
    );
};
