import type { ComponentType } from 'react';
import { GithubIcon, TelegramIcon, type IconProps } from '@/components/icons';

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

export function SiteFooter() {
    return (
        <footer className='mt-auto flex flex-col items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground sm:flex-row'>
            <p>MTG UA Community Card Searcher</p>
            <nav
                aria-label='Контакти'
                className='flex flex-wrap items-center gap-x-5 gap-y-2'
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
        </footer>
    );
}
