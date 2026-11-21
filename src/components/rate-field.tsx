import { useEffect, useState, type FormEvent } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MAX_RATE, MIN_RATE, parseRate } from '@/lib/usd-rate';
import { cn } from '@/lib/utils';

const show = (rate: number | null) =>
    // a decimal comma, but no grouping: "1 000" wouldn't parse back (parseRate)
    rate === null ? '' : rate.toLocaleString('uk-UA', { useGrouping: false });

// An exchange rate (UAH per USD) with a save button that shows once it's changed. Emptying it and saving clears it.
export function RateField({
    value,
    onSave,
    placeholder,
    label,
    hint,
    compact = false
}: {
    value: number | null;
    onSave: (rate: number | null) => Promise<unknown>; // settles when the save is done, however it went
    placeholder: string;
    label: string;
    hint?: string; // beside an empty field: what applies instead
    compact?: boolean;
}) {
    const [text, setText] = useState(show(value));
    const [saving, setSaving] = useState(false);
    // the saved value can change under it (another tab, the server rounding to the kopiyka)
    useEffect(() => setText(show(value)), [value]);

    const rate = parseRate(text);
    const invalid = rate === undefined;
    const changed = !invalid && rate !== value;

    async function save(e: FormEvent) {
        e.preventDefault();
        if (!changed) return;
        setSaving(true);
        try {
            await onSave(rate);
        } finally {
            setSaving(false);
        }
    }

    return (
        <form onSubmit={save} className='flex items-center gap-2'>
            <div className='relative'>
                <Input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    inputMode='decimal'
                    placeholder={placeholder}
                    aria-label={label}
                    aria-invalid={invalid}
                    className={cn(
                        'pr-14 tabular-nums',
                        compact ? 'h-8 w-36 text-sm' : 'h-10 w-44'
                    )}
                />
                <span className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground'>
                    ₴ за $1
                </span>
            </div>
            {changed && (
                <Button
                    type='submit'
                    size={compact ? 'sm' : 'default'}
                    disabled={saving}
                >
                    {saving ? <Loader2 className='animate-spin' /> : <Check />}
                    Зберегти
                </Button>
            )}
            {hint && rate === null && value === null && (
                <span className='text-xs text-muted-foreground'>{hint}</span>
            )}
            {invalid && (
                <span className='text-xs text-destructive'>
                    Число від {MIN_RATE} до {MAX_RATE}
                </span>
            )}
        </form>
    );
}
