import { describe, expect, test } from 'bun:test';
import { mergeRows, type ListCard } from '@/server/lists/list-card';

describe('mergeRows', () => {
    test('adds up the same printing, keeping first-seen order; other printings stay apart', () => {
        const rows: ListCard[] = [
            { name: 'Sol Ring', quantity: 1, finish: 'nonfoil', set: 'c21' },
            { name: 'Counterspell', quantity: 2, finish: 'nonfoil' },
            { name: 'sol ring', quantity: 2, finish: 'nonfoil', set: 'c21' },
            { name: 'Sol Ring', quantity: 1, finish: 'foil', set: 'c21' },
            { name: 'Sol Ring', quantity: 1, finish: 'nonfoil', set: 'cmm' },
            {
                name: 'Sol Ring',
                quantity: 1,
                finish: 'nonfoil',
                set: 'c21',
                variant: 'Retro'
            },
            {
                name: 'Sol Ring',
                quantity: 3,
                finish: 'nonfoil',
                set: 'c21',
                variant: 'retro'
            }
        ];
        expect(mergeRows(rows)).toEqual([
            { name: 'Sol Ring', quantity: 3, finish: 'nonfoil', set: 'c21' },
            { name: 'Counterspell', quantity: 2, finish: 'nonfoil' },
            { name: 'Sol Ring', quantity: 1, finish: 'foil', set: 'c21' },
            { name: 'Sol Ring', quantity: 1, finish: 'nonfoil', set: 'cmm' },
            {
                name: 'Sol Ring',
                quantity: 4,
                finish: 'nonfoil',
                set: 'c21',
                variant: 'Retro'
            }
        ]);
    });

    test("doesn't change the rows it was given", () => {
        const first: ListCard = {
            name: 'Sol Ring',
            quantity: 1,
            finish: 'nonfoil'
        };
        mergeRows([first, { ...first }]);
        expect(first.quantity).toBe(1);
    });
});
