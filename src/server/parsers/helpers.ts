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

export const abs = (base: string, path: string | undefined) =>
    path ? new URL(decodeEntities(path), base).href : null;

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
