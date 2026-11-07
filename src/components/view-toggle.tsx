import { useState } from 'react';
import { LayoutGrid, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Results layout (tiles / table), remembered per browser.
export type ResultsView = 'grid' | 'table';
const VIEW_KEY = 'searcher:view';

function loadView(): ResultsView {
    try {
        return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid';
    } catch {
        return 'grid';
    }
}

export function useResultsView() {
    const [view, setView] = useState<ResultsView>(loadView);
    const changeView = (next: ResultsView) => {
        setView(next);
        try {
            localStorage.setItem(VIEW_KEY, next);
        } catch {} // private mode / blocked storage — the choice just won't persist
    };
    return [view, changeView] as const;
}

const OPTIONS: {
    value: ResultsView;
    label: string;
    icon: typeof LayoutGrid;
}[] = [
    { value: 'grid', label: 'Плитки', icon: LayoutGrid },
    { value: 'table', label: 'Таблиця', icon: Rows3 }
];

export function ViewToggle({
    view,
    onChange
}: {
    view: ResultsView;
    onChange: (v: ResultsView) => void;
}) {
    return (
        <div
            role='radiogroup'
            aria-label='Вигляд результатів'
            className='inline-flex rounded-lg border bg-card/60 p-0.5 backdrop-blur'
        >
            {OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                    key={value}
                    type='button'
                    role='radio'
                    aria-checked={view === value}
                    onClick={() => onChange(value)}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
                        view === value
                            ? 'bg-primary text-primary-foreground shadow'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    <Icon className='size-3.5' />
                    {label}
                </button>
            ))}
        </div>
    );
}
