import { expect, test } from 'bun:test';
import { error, noContent, rowId } from '@/server/http/json-route';

test('rowId takes only an id a row could have', () => {
    expect(rowId('1')).toBe(1);
    expect(rowId('123456789012345')).toBe(123456789012345);
    for (const id of [
        '0',
        '-1',
        '1.5',
        '1e3',
        ' 1',
        'abc',
        '',
        '1234567890123456'
    ])
        expect(rowId(id), id).toBeNull();
});

test('error and noContent', async () => {
    const res = error('Not found', 404);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expect(noContent().status).toBe(204);
});
