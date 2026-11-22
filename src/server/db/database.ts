import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '@/server/observability/logger';

// The app's own data: traders, their sessions and lists. SQLite in one file, which fits the single instance the
// app runs as (see AGENTS.md); on Railway the file lives on a volume (DB_PATH), or a redeploy would wipe it.

// Each entry moves the schema one version up (SQLite's user_version). Append new ones; never edit a shipped one.
// Times are ms since the epoch; booleans are 0/1.
export const MIGRATIONS = [
    `
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        telegram_id INTEGER NOT NULL UNIQUE,
        username TEXT NOT NULL,         -- without the @; the contact link is t.me/<username>
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER NOT NULL,
        banned INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,    -- the cookie's token is never stored, only its hash
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX sessions_user ON sessions (user_id);

    CREATE TABLE lists (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('mtggoldfish', 'manabox')),
        ref TEXT NOT NULL,              -- the source's id for the list
        title TEXT,                     -- the list's name at the source, when it has one
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at INTEGER NOT NULL,
        reviewed_at INTEGER,
        edited_at INTEGER,              -- when the owner last changed it, when the source says (ManaBox)
        fetched_at INTEGER,             -- last successful refresh
        next_fetch_at INTEGER,          -- null unless approved
        last_error TEXT,
        failures INTEGER NOT NULL DEFAULT 0,  -- refreshes failed in a row
        card_count INTEGER NOT NULL DEFAULT 0, -- copies, all rows added up
        UNIQUE (source, ref)
    ) STRICT;
    CREATE INDEX lists_user ON lists (user_id);
    CREATE INDEX lists_due ON lists (next_fetch_at) WHERE status = 'approved';

    CREATE TABLE list_cards (
        list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,         -- normalize(name), what searches look up
        quantity INTEGER NOT NULL,
        finish TEXT NOT NULL CHECK (finish IN ('nonfoil', 'foil', 'etched')),
        set_code TEXT,
        collector_number TEXT,
        variant TEXT,
        scryfall_id TEXT,
        image TEXT,
        usd REAL,
        approx_price INTEGER NOT NULL DEFAULT 0 -- the price is for another printing than the seller's, maybe
    ) STRICT;
    CREATE INDEX list_cards_key ON list_cards (name_key);
    CREATE INDEX list_cards_list ON list_cards (list_id);

    CREATE TABLE card_prices (
        key TEXT PRIMARY KEY,           -- see PriceCache
        usd REAL,
        usd_foil REAL,
        usd_etched REAL,
        scryfall_id TEXT,
        image TEXT,
        fetched_at INTEGER NOT NULL
    ) STRICT;
    `,
    // Moxfield lists. SQLite can't change a CHECK in place, so the table is rebuilt, same columns in the same order.
    `
    CREATE TABLE lists_new (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('mtggoldfish', 'manabox', 'moxfield')),
        ref TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at INTEGER NOT NULL,
        reviewed_at INTEGER,
        edited_at INTEGER,
        fetched_at INTEGER,
        next_fetch_at INTEGER,
        last_error TEXT,
        failures INTEGER NOT NULL DEFAULT 0,
        card_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE (source, ref)
    ) STRICT;
    INSERT INTO lists_new SELECT * FROM lists;
    DROP TABLE lists;
    ALTER TABLE lists_new RENAME TO lists;
    CREATE INDEX lists_user ON lists (user_id);
    CREATE INDEX lists_due ON lists (next_fetch_at) WHERE status = 'approved';
    `,
    // Sellers' exchange rates, UAH per USD: their offers show Scryfall's USD price converted at it. A list's own rate
    // overrides its owner's; null is none.
    `
    ALTER TABLE users ADD COLUMN usd_rate REAL CHECK (usd_rate IS NULL OR usd_rate > 0);
    ALTER TABLE lists ADD COLUMN usd_rate REAL CHECK (usd_rate IS NULL OR usd_rate > 0);
    `
];

export function migrate(db: Database, migrations = MIGRATIONS) {
    const { user_version: version } = db
        .query<{ user_version: number }, []>('PRAGMA user_version')
        .get()!;
    // an older build against a newer file would read columns it doesn't know about wrongly, or drop them
    if (version > migrations.length)
        throw new Error(
            `Database schema is version ${version}, newer than this build's ${migrations.length}`
        );
    // A migration that rebuilds a table drops the old one, and with foreign keys on that drop would delete every row
    // referring to it (ON DELETE CASCADE). So they run with foreign keys off, as SQLite's own procedure for
    // rebuilding a table says, and are checked before they commit. The pragma can't change inside a transaction.
    const { foreign_keys: foreignKeys } = db
        .query<{ foreign_keys: number }, []>('PRAGMA foreign_keys')
        .get()!;
    db.run('PRAGMA foreign_keys = OFF');
    try {
        for (let v = version; v < migrations.length; v++) {
            db.transaction(() => {
                db.run(migrations[v]!);
                if (db.query('PRAGMA foreign_key_check').get())
                    throw new Error(
                        `Migration ${v + 1} left rows pointing at nothing`
                    );
                db.run(`PRAGMA user_version = ${v + 1}`);
            })();
            logger.info('database migrated', { version: v + 1 });
        }
    } finally {
        db.run(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }
}

// `path` is a file, or ':memory:' for tests.
export function openDatabase(path: string, migrations = MIGRATIONS): Database {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { create: true, strict: true });
    // the writer doesn't block readers (searches read while the refresh job writes)
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA busy_timeout = 5000');
    migrate(db, migrations);
    return db;
}

// DB_PATH in production (a file on the Railway volume); a git-ignored file in the project otherwise.
export function databasePath(
    env: Record<string, string | undefined> = process.env
) {
    if (env.DB_PATH) return env.DB_PATH;
    if (env.NODE_ENV === 'production')
        logger.warn(
            "DB_PATH is not set, traders' data will not survive a redeploy"
        );
    return 'data/cardsearcher.db';
}
