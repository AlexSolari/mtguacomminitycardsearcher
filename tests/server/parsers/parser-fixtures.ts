// Shared by the parser tests: each one runs its parser against a saved page from its shop (tests/fixtures/,
// refreshed by scripts/update-fixtures.ts). The snapshots catch any change in output; the explicit checks say
// what must hold whatever the shop lists. After refreshing the fixtures, review the diff and accept it with
// `bun test --update-snapshots`.
import { expect } from 'bun:test';
import type { CardResult } from '@/search-result';

const fixture = (name: string) =>
    Bun.file(new URL(`../../fixtures/${name}`, import.meta.url));
export const html = (name: string) => fixture(name).text();
export const json = (name: string) => fixture(name).json();

// What every parsed offer must look like, whichever shop it came from.
export function expectWellFormed(
    results: CardResult[],
    shop: CardResult['shop']
) {
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
        expect(r.shop).toBe(shop);
        expect(r.name.trim()).not.toBe('');
        expect(r.url).toMatch(/^https:\/\//);
        if (r.image !== null) expect(r.image).toMatch(/^https:\/\//);
        // null for unknown, never 0 (which would win best price)
        if (r.price !== null) expect(r.price).toBeGreaterThan(0);
        if (r.language) expect(r.language).toMatch(/^[A-Z]{2,3}$/);
        if (r.stock !== undefined) expect(r.stock).toBeGreaterThan(0);
    }
}
