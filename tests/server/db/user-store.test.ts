import { beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDatabase } from '@/server/db/database';
import { UserStore } from '@/server/db/user-store';
import { captureLogs } from '../capture-logs';

captureLogs(); // the migration's log line

const profile = { telegramId: 1001, username: 'trader', displayName: 'Trader' };

describe('UserStore', () => {
    let db: Database;
    let users: UserStore;
    beforeEach(() => {
        db = openDatabase(':memory:');
        users = new UserStore(db);
    });

    test('the first sign-in creates the user; later ones take their current username and name', () => {
        const first = users.login(profile, 1000);
        expect(first).toEqual({
            id: expect.any(Number),
            telegramId: 1001,
            username: 'trader',
            displayName: 'Trader',
            createdAt: 1000,
            lastLoginAt: 1000,
            banned: false
        });
        const again = users.login(
            { ...profile, username: 'renamed', displayName: 'New Name' },
            2000
        );
        expect(again).toEqual({
            ...first,
            username: 'renamed',
            displayName: 'New Name',
            lastLoginAt: 2000
        });
        expect(users.get(first.id)).toEqual(again);
        expect(users.login({ ...profile, telegramId: 1002 }, 3000).id).not.toBe(
            first.id
        );
    });

    test('get: an unknown id is null', () => {
        expect(users.get(42)).toBeNull();
    });

    test('a session finds its user until it expires or ends', () => {
        const user = users.login(profile, 0);
        users.startSession('hash-a', user.id, 5000);
        users.startSession('hash-b', user.id, 9000);
        expect(users.sessionUser('hash-a', 4999)).toEqual(user);
        expect(users.sessionUser('hash-a', 5000)).toBeNull();
        expect(users.sessionUser('unknown', 0)).toBeNull();
        users.endSession('hash-b');
        expect(users.sessionUser('hash-b', 0)).toBeNull();
    });

    test('purgeSessions drops the expired ones only', () => {
        const user = users.login(profile, 0);
        users.startSession('old', user.id, 1000);
        users.startSession('new', user.id, 3000);
        expect(users.purgeSessions(2000)).toBe(1);
        expect(users.sessionUser('new', 2000)?.id).toBe(user.id);
    });

    test('a ban ends their sessions and keeps them out; lifting it lets them sign in again', () => {
        const user = users.login(profile, 0);
        users.startSession('hash', user.id, 9000);
        expect(users.setBanned(user.id, true)).toBe(true);
        expect(users.sessionUser('hash', 0)).toBeNull();
        expect(users.login(profile, 1).banned).toBe(true);
        users.startSession('hash2', user.id, 9000);
        expect(users.sessionUser('hash2', 0)).toBeNull();

        expect(users.setBanned(user.id, false)).toBe(true);
        expect(users.sessionUser('hash2', 0)?.banned).toBe(false);
        expect(users.setBanned(42, true)).toBe(false);
    });

    test('remove deletes the user with their sessions and lists', () => {
        const user = users.login(profile, 0);
        users.startSession('hash', user.id, 9000);
        db.run(
            `INSERT INTO lists (user_id, source, ref, created_at) VALUES (?, 'manabox', 'abc', 0)`,
            [user.id]
        );
        expect(users.remove(user.id)).toBe(true);
        expect(users.get(user.id)).toBeNull();
        expect(db.query('SELECT * FROM sessions').all()).toEqual([]);
        expect(db.query('SELECT * FROM lists').all()).toEqual([]);
        expect(users.remove(user.id)).toBe(false);
    });
});
