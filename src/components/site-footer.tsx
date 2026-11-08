import type { ComponentType } from 'react';
import { GithubIcon, TelegramIcon, type IconProps } from '@/components/icons';
import { ThemeToggle } from '@/components/theme-toggle';

const CONTACTS: {
    label: string;
    href: string;
    icon: ComponentType<IconProps>;
}[] = [
    {
        label: 'CheeseSolari',
        href: 'https://t.me/CheeseSolari',
        icon: TelegramIcon
    },
    {
        label: 'Повідомити про помилку',
        href: 'https://github.com/AlexSolari/mtguacomminitycardsearcher/issues',
        icon: GithubIcon
    }
];

// Wide screens: name on the left, then contacts and the theme toggle on the right.
// Phones: a grid, so the name and toggle always share the first row (on the narrowest screens the name
// wraps rather than pushing the toggle down), with the contacts in a full-width row below.
export function SiteFooter() {
    return (
        <footer className='mt-auto grid grid-cols-[minmax(0,max-content)_auto] items-center justify-center gap-3 border-t pt-4 text-sm text-muted-foreground sm:flex sm:gap-x-5'>
            <p className='text-center sm:mr-auto sm:text-left'>
                MTG UA Community Card Searcher
            </p>
            <nav
                aria-label='Контакти'
                className='col-span-2 row-start-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2'
            >
                {CONTACTS.map(({ label, href, icon: Icon }) => (
                    <a
                        key={href}
                        href={href}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='inline-flex items-center gap-1.5 transition-colors hover:text-primary'
                    >
                        <Icon className='size-4' />
                        {label}
                    </a>
                ))}
            </nav>
            <ThemeToggle />
        </footer>
    );
}
