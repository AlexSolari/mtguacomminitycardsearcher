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

    test('migration 2 rebuilds lists for Moxfield, keeping every list and its cards', () => {
        const db = new Database(':memory:', { strict: true });
        db.run('PRAGMA foreign_keys = ON');
        migrate(db, MIGRATIONS.slice(0, 1));
        db.run(
            `INSERT INTO users (telegram_id, username, display_name, created_at, last_login_at)
             VALUES (1, 'trader', 'Trader', 0, 0)`
        );
        db.run(
            `INSERT INTO lists (user_id, source, ref, status, created_at, next_fetch_at)
             VALUES (1, 'manabox', 'abc', 'approved', 5, 10)`
        );
        db.run(
            `INSERT INTO list_cards (list_id, name, name_key, quantity, finish)
             VALUES (1, 'Sol Ring', 'sol ring', 2, 'nonfoil')`
        );
        expect(() =>
            db.run(
                `INSERT INTO lists (user_id, source, ref, created_at) VALUES (1, 'moxfield', 'x', 0)`
            )
        ).toThrow(/CHECK/);

        migrate(db);
        expect(version(db)).toBe(MIGRATIONS.length);
        expect(
            db
                .query(
                    'SELECT id, source, ref, status, next_fetch_at FROM lists'
                )
                .all()
        ).toEqual([
            {
                id: 1,
                source: 'manabox',
                ref: 'abc',
                status: 'approved',
                next_fetch_at: 10
            }
        ]);
        expect(db.query('SELECT list_id, name FROM list_cards').all()).toEqual([
            { list_id: 1, name: 'Sol Ring' }
        ]);
        db.run(
            `INSERT INTO lists (user_id, source, ref, created_at) VALUES (1, 'moxfield', 'x', 0)`
        );
        expect(() =>
            db.run(
                `INSERT INTO lists (user_id, source, ref, created_at) VALUES (1, 'archidekt', 'y', 0)`
            )
        ).toThrow(/CHECK/);
        expect(
            db
                .query<{ name: string }, []>(
                    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'lists' AND sql IS NOT NULL ORDER BY name"
                )
                .all()
                .map((i) => i.name)
        ).toEqual(['lists_due', 'lists_user']);
        // foreign keys are back on, and still cascade to the rebuilt table's cards
        expect(
            db.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()
        ).toEqual({ foreign_keys: 1 });
        db.run('DELETE FROM users');
        expect(db.query('SELECT * FROM list_cards').all()).toEqual([]);
    });

    test('a migration that leaves rows pointing at nothing is rolled back, foreign keys back as they were', () => {
        const db = new Database(':memory:');
        db.run('PRAGMA foreign_keys = ON');
        expect(() =>
            migrate(db, [
                `CREATE TABLE p (id INTEGER PRIMARY KEY);
                 CREATE TABLE c (p INTEGER REFERENCES p (id));
                 INSERT INTO c VALUES (7);`
            ])
        ).toThrow('Migration 1 left rows pointing at nothing');
        expect(version(db)).toBe(0);
        expect(tables(db)).toEqual([]);
        expect(
            db.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()
        ).toEqual({ foreign_keys: 1 });
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
