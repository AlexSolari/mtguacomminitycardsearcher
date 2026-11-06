// Next.js App Router pages stream their data as `self.__next_f.push([1,"<chunk>"])` scripts. Concatenating the
// (JSON-string-encoded) chunks gives the "flight" payload, where component props appear as plain JSON.
export function readNextFlight(html: string) {
    let out = '';
    for (const m of html.matchAll(
        /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
    ))
        out += JSON.parse(m[1]!);
    return out;
}

// Pull the JSON array that follows `"key":[` out of a larger blob, by bracket matching.
export function extractJsonArray(blob: string, key: string): any[] | null {
    const at = blob.indexOf(`"${key}":[`);
    if (at < 0) return null;
    const start = at + key.length + 3;
    let depth = 0;
    let inString = false;
    for (let i = start; i < blob.length; i++) {
        const c = blob[i];
        if (inString) {
            if (c === '\\') i++;
            else if (c === '"') inString = false;
        } else if (c === '"') inString = true;
        else if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') {
            if (--depth === 0) return JSON.parse(blob.slice(start, i + 1));
        }
    }
    return null;
}

export const decodeEntities = (s: string) =>
    s
        .replace(/&quot;/g, '"')
        .replace(/&mdash;/g, '—')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');

export const parsePrice = (s: string | undefined) => {
    if (!s) return null;
    const n = Number(s.replace(/[^\d]/g, ''));
    return Number.isFinite(n) && s.trim() ? n : null;
};

export const abs = (base: string, path: string | undefined) =>
    path ? new URL(decodeEntities(path), base).href : null;
