#!/usr/bin/env bun
// Renders scripts/og-image.html to src/og-image.png, the link preview image Telegram and others show (og:image).
// Rerun it after changing the template or the shop list. Needs Chrome or Edge; CHROME_PATH overrides the lookup.
import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import path from 'path';
import { SHOP_INFO } from '../src/shops';

const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
];
const chrome = candidates.find((p) => p && existsSync(p));
if (!chrome) throw new Error('Chrome not found; set CHROME_PATH');

const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const shops = Object.values(SHOP_INFO);

// Each shop's favicon, inlined as a data URI: Chrome would render a failed download as a broken image, this fails loudly
async function iconDataUri(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const type = res.headers.get('content-type')?.split(';')[0] || 'image/png';
    if (!type.startsWith('image/')) throw new Error(`${url}: got ${type}`);
    const data = Buffer.from(await res.arrayBuffer()).toString('base64');
    return `data:${type};base64,${data}`;
}
const icons = await Promise.all(shops.map((s) => iconDataUri(s.icon)));
const template = await Bun.file(
    path.join(import.meta.dir, 'og-image.html')
).text();
const html = template
    .replaceAll('{{SHOP_COUNT}}', String(shops.length))
    .replace(
        '{{SHOPS}}',
        shops
            .map(
                (s, i) =>
                    `<span><img src="${icons[i]}" alt="" />${escape(s.label)}</span>`
            )
            .join('')
    );

// next to the template, so its relative link to ../src/favicon.svg resolves
const page = path.join(import.meta.dir, '.og-image.rendered.html');
const out = path.resolve(import.meta.dir, '../src/og-image.png');
await Bun.write(page, html);
try {
    const proc = Bun.spawn(
        [
            chrome,
            '--headless=new',
            '--hide-scrollbars',
            '--force-device-scale-factor=1',
            '--window-size=1200,630',
            // gives the Google Fonts stylesheet time to load before the screenshot
            '--virtual-time-budget=10000',
            `--screenshot=${out}`,
            Bun.pathToFileURL(page).href
        ],
        { stdout: 'inherit', stderr: 'inherit' }
    );
    if ((await proc.exited) !== 0) throw new Error('Chrome failed');
} finally {
    await rm(page, { force: true });
}
console.log(`wrote ${path.relative(process.cwd(), out)}`);
