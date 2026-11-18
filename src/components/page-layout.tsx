import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

// The frame of the pages besides the search (traders' lists, moderation): the site's header and footer around a
// narrower column, with the page's title.
export function PageLayout({
    title,
    children
}: {
    title: string;
    children: ReactNode;
}) {
    return (
        <div className='mx-auto flex min-h-dvh max-w-7xl flex-col gap-6 px-4 pt-6 pb-10 sm:px-6 sm:pt-10 lg:py-8'>
            <SiteHeader />
            {/* grid-cols-1: a long link must wrap, not widen the page */}
            <main className='mx-auto grid w-full max-w-3xl grid-cols-1 content-start gap-5'>
                <h2 className='font-display text-2xl font-bold tracking-wide'>
                    {title}
                </h2>
                {children}
            </main>
            <SiteFooter />
        </div>
    );
}

const NOTICE_TONES = {
    info: {
        icon: Info,
        className: 'border-primary/30 bg-primary/10 text-foreground'
    },
    ok: {
        icon: CheckCircle2,
        className:
            'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    },
    error: {
        icon: AlertTriangle,
        className: 'border-destructive/30 bg-destructive/10 text-destructive'
    }
};

export function Notice({
    tone = 'info',
    children
}: {
    tone?: keyof typeof NOTICE_TONES;
    children: ReactNode;
}) {
    const { icon: Icon, className } = NOTICE_TONES[tone];
    return (
        <div
            role={tone === 'error' ? 'alert' : undefined}
            className={cn(
                'flex gap-2 rounded-lg border px-3 py-2.5 text-sm leading-relaxed',
                className
            )}
        >
            <Icon className='mt-0.5 size-4 shrink-0' />
            <div className='min-w-0'>{children}</div>
        </div>
    );
}

export function Loading() {
    return (
        <p className='flex items-center gap-2 text-muted-foreground'>
            <Loader2 className='size-4 animate-spin' />
            Завантаження…
        </p>
    );
}

// What every failed request says when the server itself couldn't be reached or failed.
export const SERVER_ERROR =
    'Не вдалося зв’язатися із сервером. Спробуйте ще раз трохи згодом.';
