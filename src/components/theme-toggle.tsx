import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/use-theme';
import type { ThemePreference } from '@/theme';

const OPTIONS: {
    value: ThemePreference;
    label: string;
    icon: typeof Monitor;
}[] = [
    { value: 'system', label: 'Як у системі', icon: Monitor },
    { value: 'light', label: 'Світла тема', icon: Sun },
    { value: 'dark', label: 'Темна тема', icon: Moon }
];

export function ThemeToggle({ className }: { className?: string }) {
    const [preference, setPreference] = useTheme();
    return (
        <div
            role='radiogroup'
            aria-label='Тема'
            className={cn(
                'inline-flex rounded-lg border bg-card/60 p-0.5 backdrop-blur',
                className
            )}
        >
            {OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                    key={value}
                    type='button'
                    role='radio'
                    aria-checked={preference === value}
                    aria-label={label}
                    title={label}
                    onClick={() => setPreference(value)}
                    className={cn(
                        'grid size-8 cursor-pointer sm:size-9 place-items-center rounded-md transition',
                        preference === value
                            ? 'bg-primary-fill text-primary-foreground shadow'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    <Icon className='size-4.5' />
                </button>
            ))}
        </div>
    );
}
