import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import {
    databasePath,
    migrate,
    MIGRATIONS,
    openDatabase
} from '@/server/db/database';
import { captureLogs } from '../capture-logs';

const logs = captureLogs();
const version = (db: Database) =>
    db.query<{ user_version: number }, []>('PRAGMA user_version').get()!
        .user_version;
const tables = (db: Database) =>
    db
        .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all()
        .map((t) => t.name);

describe('openDatabase', () => {
    test('a new database gets the whole schema, with foreign keys enforced', () => {
        const db = openDatabase(':memory:');
        expect(version(db)).toBe(MIGRATIONS.length);
        expect(tables(db)).toEqual([
            'card_prices',
            'list_cards',
            'lists',
            'sessions',
            'users'
        ]);
        expect(
            db.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()
        ).toEqual({ foreign_keys: 1 });
        expect(() =>
            db.run(
                'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
                ['h', 999, 1]
            )
        ).toThrow(/FOREIGN KEY/);
    });

    const dir = mkdtempSync(join(tmpdir(), 'cardsearcher-db-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test("a file database: its folder is created, it's in WAL mode, and reopening it keeps the data", () => {
        const path = join(dir, 'nested', 'test.db');
        const db = openDatabase(path);
        expect(
            db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()
        ).toEqual({ journal_mode: 'wal' });
        db.run(
            `INSERT INTO users (telegram_id, username, display_name, created_at, last_login_at)
             VALUES (1, 'trader', 'Trader', 0, 0)`
        );
        db.close();

        const reopened = openDatabase(path);
        expect(version(reopened)).toBe(MIGRATIONS.length);
        expect(reopened.query('SELECT username FROM users').all()).toEqual([
            { username: 'trader' }
        ]);
        reopened.close();
    });
});

describe('migrate', () => {
    const steps = [
        'CREATE TABLE a (x INTEGER) STRICT;',
        'CREATE TABLE b (y TEXT) STRICT; INSERT INTO a VALUES (1);'
    ];

    test('runs only the migrations the database is missing, logging each', () => {
        const db = new Database(':memory:');
        migrate(db, steps.slice(0, 1));
        expect(version(db)).toBe(1);
        migrate(db, steps);
        expect(version(db)).toBe(2);
        expect(tables(db)).toEqual(['a', 'b']);
        expect(db.query('SELECT x FROM a').all()).toEqual([{ x: 1 }]);
        migrate(db, steps);
        expect(
            logs
                .filter((l) => l.message === 'database migrated')
                .map((l) => l.version)
        ).toEqual([1, 2]);
    });

    test('a failing migration is rolled back whole', () => {
        const db = new Database(':memory:');
        expect(() =>
            migrate(db, ['CREATE TABLE a (x INTEGER); NOT SQL;'])
        ).toThrow();
        expect(version(db)).toBe(0);
        expect(tables(db)).toEqual([]);
    });

    test('a database newer than the code is refused', () => {
        const db = new Database(':memory:');
        migrate(db, steps);
        expect(() => migrate(db, steps.slice(0, 1))).toThrow(
            "Database schema is version 2, newer than this build's 1"
        );
    });
});

describe('databasePath', () => {
    test('DB_PATH when set', () => {
        expect(
            databasePath({ DB_PATH: '/data/x.db', NODE_ENV: 'production' })
        ).toBe('/data/x.db');
        expect(logs).toEqual([]);
    });

    test("a project file otherwise; in production that's worth a warning", () => {
        expect(databasePath({})).toBe('data/cardsearcher.db');
        expect(logs).toEqual([]);
        expect(databasePath({ NODE_ENV: 'production' })).toBe(
            'data/cardsearcher.db'
        );
        expect(logs.map((l) => [l.level, l.message])).toEqual([
            [
                'warn',
                "DB_PATH is not set, traders' data will not survive a redeploy"
            ]
        ]);
    });
});
