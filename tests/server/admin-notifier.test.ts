// Against a local stand-in for Telegram's Bot API, never the real one.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
    AdminNotifier,
    adminNotifierConfig,
    isQuietHour,
    submittedMessage,
    type AdminNotifierConfig
} from '@/server/admin-notifier';
import type { TraderList } from '@/server/db/list-store';
import type { User } from '@/server/db/user-store';
import { ShopClient } from '@/server/shop-client';
import { captureLogs } from './capture-logs';

const TOKEN = '123456:secret-token';
// moderator 2 hasn't pressed Start in the bot
const BLOCKED = 2;

const sent: { path: string; body: Record<string, unknown> }[] = [];
const server = Bun.serve({
    port: 0,
    async fetch(req) {
        const body = (await req.json()) as Record<string, unknown>;
        sent.push({ path: new URL(req.url).pathname, body });
        if (body.chat_id === BLOCKED)
            return Response.json(
                {
                    ok: false,
                    error_code: 403,
                    description:
                        "Forbidden: bot can't initiate conversation with a user"
                },
                { status: 403 }
            );
        return Response.json({ ok: true, result: { message_id: 1 } });
    }
});
afterAll(() => server.stop(true));

const logs = captureLogs();
beforeEach(() => (sent.length = 0));

const user: User = {
    id: 7,
    telegramId: 555,
    username: 'trader',
    displayName: 'Іван <Ваня>',
    createdAt: 0,
    lastLoginAt: 0,
    banned: false
};
const list = (id: number, source: TraderList['source'], ref: string) =>
    ({ id, source, ref }) as TraderList;
const lists = [
    list(1, 'manabox', 'Qsjv6XwMQ_SynKoo3V-epw'),
    list(2, 'mtggoldfish', '6906342')
];

// 2025-06-01 12:00 and 23:30 in Kyiv (UTC+3)
const NOON = Date.UTC(2025, 5, 1, 9, 0);
const LATE = Date.UTC(2025, 5, 1, 20, 30);

const notifier = (config: Partial<AdminNotifierConfig> = {}, now = NOON) =>
    new AdminNotifier(
        {
            botToken: TOKEN,
            adminChatIds: [1],
            adminUrl: 'https://cards.example/admin',
            ...config
        },
        new ShopClient(`http://localhost:${server.port}`, {
            intervalMs: 1,
            secret: TOKEN
        }),
        () => now
    );

describe('adminNotifierConfig', () => {
    test('off without a bot token or a moderator', () => {
        expect(adminNotifierConfig(new Set([1]), 'https://x', {})).toBeNull();
        expect(
            adminNotifierConfig(new Set(), 'https://x', {
                TELEGRAM_BOT_TOKEN: TOKEN
            })
        ).toBeNull();
    });

    test('messages every moderator, linking to /admin on the public site', () => {
        expect(
            adminNotifierConfig(new Set([1, 2]), 'https://cards.example/', {
                TELEGRAM_BOT_TOKEN: ` ${TOKEN} `
            })
        ).toEqual({
            botToken: TOKEN,
            adminChatIds: [1, 2],
            adminUrl: 'https://cards.example/admin'
        });
    });
});

test('the message names the trader and links each list, escaped for HTML', () => {
    expect(submittedMessage(user, lists, 5)).toBe(
        [
            '📋 <b>Нові списки на перевірку: 2</b>',
            '',
            '@trader (Іван &lt;Ваня&gt;)',
            '• ManaBox: https://manabox.app/decks/Qsjv6XwMQ_SynKoo3V-epw',
            '• MTGGoldfish: https://www.mtggoldfish.com/deck/6906342',
            '',
            'Усього на перевірці: 5 списків'
        ].join('\n')
    );
    expect(
        submittedMessage({ ...user, displayName: ' ' }, lists, 1).split('\n')[2]
    ).toBe('@trader');
});

test('quiet hours are 23:00 to 07:59 in Kyiv', () => {
    expect(isQuietHour(NOON)).toBe(false);
    expect(isQuietHour(LATE)).toBe(true);
    expect(isQuietHour(Date.UTC(2025, 5, 1, 4, 59))).toBe(true); // 07:59
    expect(isQuietHour(Date.UTC(2025, 5, 1, 5, 0))).toBe(false); // 08:00
});

describe('AdminNotifier', () => {
    test('sends each moderator the message, with a button to the moderation page', async () => {
        await notifier({ adminChatIds: [1, 3] }).listsSubmitted(user, lists, 2);
        // sent at once, so in any order
        expect(sent.map((s) => s.body.chat_id).sort()).toEqual([1, 3]);
        expect(sent.find((s) => s.body.chat_id === 1)).toEqual({
            path: `/bot${TOKEN}/sendMessage`,
            body: {
                chat_id: 1,
                text: submittedMessage(user, lists, 2),
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true },
                disable_notification: false,
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Відкрити модерацію',
                                url: 'https://cards.example/admin'
                            }
                        ]
                    ]
                }
            }
        });
        expect(logs.map((l) => [l.message, l.sent, l.failed])).toEqual([
            ['admins notified', 2, 0]
        ]);
    });

    test('at night the message arrives silently', async () => {
        await notifier({}, LATE).listsSubmitted(user, lists, 2);
        expect(sent[0]!.body.disable_notification).toBe(true);
    });

    test('a link Telegram would refuse as a button (localhost) goes in the text', async () => {
        await notifier({
            adminUrl: 'http://localhost:3000/admin'
        }).listsSubmitted(user, lists, 2);
        expect(sent[0]!.body.reply_markup).toBeUndefined();
        expect(sent[0]!.body.text).toEndWith('\nhttp://localhost:3000/admin');
    });

    test("a moderator who can't be messaged is logged without the token or their id; the others still get it", async () => {
        await notifier({ adminChatIds: [BLOCKED, 1] }).listsSubmitted(
            user,
            lists,
            2
        );
        expect(sent).toHaveLength(2);
        expect(logs.map((l) => [l.message, l.user])).toEqual([
            ['admin notification failed', user.id],
            ['admins notified', user.id]
        ]);
        expect(logs[0]!.error).toMatchObject({
            status: 403,
            url: expect.stringContaining('/bot[secret]/sendMessage')
        });
        expect(logs[1]).toMatchObject({ sent: 1, failed: 1 });
        const logged = JSON.stringify(logs);
        expect(logged).not.toContain(TOKEN);
        expect(logged).not.toContain(`"${BLOCKED}"`);
        expect(logged).not.toContain(String(user.telegramId));
    });

    test('nothing submitted, nothing sent', async () => {
        await notifier().listsSubmitted(user, [], 0);
        expect(sent).toEqual([]);
    });
});
