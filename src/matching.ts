// Card name matching. Shared between server and frontend — keep free of server-only imports.
import type { CardResult } from './search-result';

// "Jace, the Mind-Sculptor" → "jace the mind sculptor"; "Æther Vial" / "Lim-Dûl's Vault" → "aether vial" / "lim dul s vault"
export const normalize = (s: string) =>
    s
        .toLowerCase()
        .replace(/æ/g, 'ae') // a ligature, not a letter with an accent, so NFKD leaves it alone
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

// Is `listing` exactly the searched card, ignoring shop decorations? Handles:
//   "Daze (PLST-DD2-23)"                         (CartOn set suffix)
//   "Daze — Nemesis #29, Foil, English"          (Nerdik edition suffix)
//   "Emeritus of Woe // Demonic Tutor"           (either face of a split / MDFC card, or the full name)
export function isExactMatch(listing: string, query: string) {
    const q = normalize(query);
    const name = listing
        .split(' — ')[0]!
        .replace(/\s+\([A-Z0-9]+-[^)]*\)$/i, '');
    return [name, ...name.split(' // ')].some((n) => normalize(n) === q);
}

// Art Series cards are collectible art cards, not playable copies — grouped separately and kept out of pricing.
export const isArtSeries = (l: CardResult) =>
    l.artSeries === true || /\bart series\b/i.test(l.name);
