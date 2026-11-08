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

// "1 234 ₴" → 1234; text without digits ("—", "Немає") → null, not 0
export const parsePrice = (s: string | undefined) => {
    const digits = s?.replace(/[^\d]/g, '');
    return digits ? Number(digits) : null;
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
    ukrainian: 'UK'
};
export const languageCode = (s: string | null | undefined) => {
    if (!s) return undefined;
    const t = s.trim();
    return (
        LANGUAGE_CODES[t.toLowerCase()] ??
        (t.length <= 3 ? t.toUpperCase() : undefined)
    );
};
