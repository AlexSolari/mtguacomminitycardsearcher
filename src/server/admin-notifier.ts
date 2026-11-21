import { LISTS, plural } from '../i18n';
import type { TraderList } from './db/list-store';
import type { User } from './db/user-store';
import { LIST_SOURCES } from './lists/list-link';
import { logger } from './logger';
import { ShopClient } from './shop-client';

// Tells the moderators, in Telegram, when a trader submits lists for review. The message comes from the sign-in
// bot, whose API token (@BotFather → the bot → API Token) is TELEGRAM_BOT_TOKEN; it's not the Login Widget's
// client secret. A bot can only write to someone who has started a chat with it, so each moderator presses Start
// in the bot once; until then their messages fail with a 403, which is logged.
//
//   📋 Нові списки на перевірку: 2
//   @trader (Іван)
//   • ManaBox: https://manabox.app/decks/…
//   • Moxfield: https://moxfield.com/decks/…
//   Усього на перевірці: 5
//   [Відкрити модерацію] → <site>/admin

export const TELEGRAM_API = 'https://api.telegram.org';

// Kyiv hours when messages arrive without a sound: 23:00…07:59.
const QUIET = { tz: 'Europe/Kyiv', from: 23, to: 8 };
const LOCAL_HOUR = new Intl.DateTimeFormat('en-GB', {
    timeZone: QUIET.tz,
    hour: 'numeric',
    hourCycle: 'h23'
});
export function isQuietHour(at: number): boolean {
    const hour = Number(LOCAL_HOUR.format(at));
    return hour >= QUIET.from || hour < QUIET.to;
}

const escapeHtml = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type AdminNotifierConfig = {
    botToken: string;
    adminChatIds: number[]; // the moderators' Telegram ids, which are also their chats with the bot
    adminUrl: string; // the moderation page
};

// From the environment: TELEGRAM_BOT_TOKEN, the moderators (ADMIN_TELEGRAM_IDS, as `adminIds` reads them) and the
// site's public URL. null (notifications off) without a token or a moderator.
export function adminNotifierConfig(
    admins: Set<number>,
    publicOrigin: string,
    env: Record<string, string | undefined> = process.env
): AdminNotifierConfig | null {
    const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
    if (!botToken || admins.size === 0) return null;
    return {
        botToken,
        adminChatIds: [...admins],
        adminUrl: new URL('/admin', publicOrigin).href
    };
}

// After a message about a trader's lists, the next about theirs waits this long: lists they submit meanwhile are
// held, and go in one message when it ends. Someone adding lists one at a time, or a script adding and deleting them
// in a loop, sends each moderator a message per window rather than one per submission, and no list goes unannounced.
export const COOLDOWN_MS = 10 * 60_000;
// The most lists one message links; the rest are counted. Telegram's limit is 4096 characters, about 40 rows.
export const MAX_ROWS = 20;

// The message about `lists` (and `more` not linked), just submitted by `user`; `pending` is the whole queue, these
// included.
export function submittedMessage(
    user: Pick<User, 'username' | 'displayName'>,
    lists: Pick<TraderList, 'source' | 'ref'>[],
    pending: number,
    more = 0
): string {
    const rows = lists.map((l) => {
        const { label, link } = LIST_SOURCES[l.source];
        return `• ${escapeHtml(label)}: ${escapeHtml(link(l.ref))}`;
    });
    if (more > 0) rows.push(`• і ще ${plural(more, LISTS)}`);
    const name = user.displayName.trim();
    return [
        `📋 <b>Нові списки на перевірку: ${lists.length + more}</b>`,
        '',
        `@${escapeHtml(user.username)}${name ? ` (${escapeHtml(name)})` : ''}`,
        ...rows,
        '',
        `Усього на перевірці: ${plural(pending, LISTS)}`
    ].join('\n');
}

// A trader's lists waiting for their cooldown to end: the first MAX_ROWS, and how many more.
type Held = { user: User; lists: TraderList[]; more: number; pending: number };

// Runs `run` after `ms`, without keeping the process alive for it; a parameter for tests. A one-off timer, so a
// `bun --hot` reload is harmless: one left from before it just sends what it held.
type Defer = (run: () => void, ms: number) => void;
const unrefTimeout: Defer = (run, ms) => void setTimeout(run, ms).unref();

export class AdminNotifier {
    constructor(
        private readonly config: AdminNotifierConfig,
        private readonly client = new ShopClient(TELEGRAM_API, {
            // Telegram allows a bot about 30 messages a second; a message per moderator needs far fewer
            intervalMs: 100,
            timeoutMs: 10_000,
            secret: config.botToken
        }),
        private readonly now = () => Date.now(),
        private readonly defer: Defer = unrefTimeout
    ) {}

    // Per trader in their cooldown (see COOLDOWN_MS): the lists held for its end, or null while there are none.
    private readonly cooling = new Map<number, Held | null>();

    // Tells every moderator, at once or when the trader's cooldown ends. Never throws: a trader's submission doesn't
    // depend on it.
    async listsSubmitted(
        user: User,
        lists: TraderList[],
        pending: number,
        more = 0
    ): Promise<void> {
        if (lists.length === 0) return;
        if (this.cooling.has(user.id)) {
            this.hold(user, lists, pending);
            return;
        }
        this.cooling.set(user.id, null);
        this.defer(() => void this.cooled(user.id), COOLDOWN_MS);
        await this.send(user, lists, pending, more);
    }

    private hold(user: User, lists: TraderList[], pending: number) {
        const held = this.cooling.get(user.id) ?? {
            user,
            lists: [],
            more: 0,
            pending
        };
        // only the first MAX_ROWS are kept, so a script looping can't grow it
        const room = Math.max(0, MAX_ROWS - held.lists.length);
        held.lists.push(...lists.slice(0, room));
        held.more += Math.max(0, lists.length - room);
        // the latest: the queue's size, and the trader's name, as they are now
        held.pending = pending;
        held.user = user;
        this.cooling.set(user.id, held);
        logger.info('admin notification held', {
            user: user.id,
            lists: held.lists.length + held.more
        });
    }

    // The cooldown is over: what was held goes now, which starts the next one.
    private async cooled(userId: number) {
        const held = this.cooling.get(userId);
        this.cooling.delete(userId);
        if (held)
            await this.listsSubmitted(
                held.user,
                held.lists,
                held.pending,
                held.more
            );
    }

    private async send(
        user: User,
        lists: TraderList[],
        pending: number,
        more: number
    ) {
        const text = submittedMessage(user, lists, pending, more);
        // Telegram rejects a button that links to localhost, so in dev the link goes in the text instead
        const button = this.config.adminUrl.startsWith('https://');
        const body = {
            text: button ? text : `${text}\n${this.config.adminUrl}`,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            disable_notification: isQuietHour(this.now()),
            ...(button && {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Відкрити модерацію',
                                url: this.config.adminUrl
                            }
                        ]
                    ]
                }
            })
        };
        const url = this.client.url(`/bot${this.config.botToken}/sendMessage`);
        const sent = await Promise.allSettled(
            this.config.adminChatIds.map((chatId) =>
                this.client.fetchJson(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, ...body })
                })
            )
        );
        // the moderators' Telegram ids stay out of the log, like every user's
        for (const result of sent)
            if (result.status === 'rejected')
                logger.warn('admin notification failed', {
                    user: user.id,
                    error: result.reason
                });
        logger.info('admins notified', {
            user: user.id,
            lists: lists.length + more,
            sent: sent.filter((r) => r.status === 'fulfilled').length,
            failed: sent.filter((r) => r.status === 'rejected').length
        });
    }
}
