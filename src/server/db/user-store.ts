import type { Database } from 'bun:sqlite';

// A trader, as Telegram identified them at their last sign-in.
export type User = {
    id: number;
    telegramId: number;
    username: string; // without the @
    displayName: string;
    createdAt: number;
    lastLoginAt: number;
    banned: boolean;
};

// What Telegram's sign-in tells us about a user.
export type TelegramProfile = {
    telegramId: number;
    username: string;
    displayName: string;
};

type UserRow = Omit<User, 'banned'> & { banned: number };

const USER_COLUMNS = `
    users.id, users.telegram_id AS telegramId, users.username, users.display_name AS displayName,
    users.created_at AS createdAt, users.last_login_at AS lastLoginAt, users.banned`;

const toUser = (row: UserRow | null): User | null =>
    row && { ...row, banned: row.banned === 1 };

// Users and their sign-in sessions. A session is stored by its token's hash (see the auth routes), so a leaked
// database holds no usable session.
export class UserStore {
    constructor(private readonly db: Database) {}

    // Records a sign-in: creates the user on their first one, otherwise takes Telegram's current username and
    // name. A banned user is still returned (with `banned`), for the caller to turn away.
    login(profile: TelegramProfile, now = Date.now()): User {
        return toUser(
            this.db
                .query<UserRow, Record<string, string | number>>(
                    `INSERT INTO users (telegram_id, username, display_name, created_at, last_login_at)
                     VALUES ($telegramId, $username, $displayName, $now, $now)
                     ON CONFLICT (telegram_id) DO UPDATE SET
                         username = excluded.username,
                         display_name = excluded.display_name,
                         last_login_at = excluded.last_login_at
                     RETURNING ${USER_COLUMNS}`
                )
                .get({ ...profile, now })
        )!;
    }

    get(id: number): User | null {
        return toUser(
            this.db
                .query<UserRow, [number]>(
                    `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`
                )
                .get(id)
        );
    }

    // Deletes the user with their sessions and lists (the account deletion they can ask for).
    remove(id: number): boolean {
        return this.db.run('DELETE FROM users WHERE id = ?', [id]).changes > 0;
    }

    // A ban also ends their sessions; their lists stay out of search while it lasts (see ListStore.offers).
    // The seller's exchange rate, UAH per USD, for their lists that have none of their own; null when unset.
    usdRate(id: number): number | null {
        return (
            this.db
                .query<{ usdRate: number | null }, [number]>(
                    'SELECT usd_rate AS usdRate FROM users WHERE id = ?'
                )
                .get(id)?.usdRate ?? null
        );
    }

    setUsdRate(id: number, rate: number | null) {
        this.db.run('UPDATE users SET usd_rate = ? WHERE id = ?', [rate, id]);
    }

    setBanned(id: number, banned: boolean): boolean {
        return this.db.transaction(() => {
            const changed =
                this.db.run('UPDATE users SET banned = ? WHERE id = ?', [
                    banned ? 1 : 0,
                    id
                ]).changes > 0;
            if (changed && banned)
                this.db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
            return changed;
        })();
    }

    startSession(tokenHash: string, userId: number, expiresAt: number) {
        this.db.run(
            'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
            [tokenHash, userId, expiresAt]
        );
    }

    // The signed-in user, or null for an unknown, expired or banned session.
    sessionUser(tokenHash: string, now = Date.now()): User | null {
        return toUser(
            this.db
                .query<UserRow, [string, number]>(
                    `SELECT ${USER_COLUMNS} FROM sessions JOIN users ON users.id = sessions.user_id
                     WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.banned = 0`
                )
                .get(tokenHash, now)
        );
    }

    endSession(tokenHash: string) {
        this.db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
    }

    // Drops expired sessions; returns how many.
    purgeSessions(now = Date.now()): number {
        return this.db.run('DELETE FROM sessions WHERE expires_at <= ?', [now])
            .changes;
    }
}
