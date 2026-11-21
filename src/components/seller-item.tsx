import { List } from 'lucide-react';
import type { ModeratedSeller } from '@/account';
import { formatDate } from '@/components/list-parts';
import { BanButton, type Act } from '@/components/moderated-list-item';
import { Button } from '@/components/ui/button';
import { setBanned } from '@/lib/account-api';

// A seller on /admin's "Продавці" tab: who they are, their lists' states, exchange rate and dates. "Показати
// списки" opens their lists; a moderator can't be banned.
export function SellerItem({
    seller,
    busy,
    act,
    onShowLists
}: {
    seller: ModeratedSeller;
    busy: boolean;
    act: Act;
    onShowLists: () => void;
}) {
    return (
        <li className='grid gap-3 rounded-lg border bg-card px-4 py-3'>
            <div className='grid min-w-0 gap-0.5'>
                <p className='min-w-0 font-medium'>
                    {seller.displayName}{' '}
                    <a
                        href={`https://t.me/${seller.username}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='font-normal text-primary hover:underline'
                    >
                        @{seller.username}
                    </a>
                    {seller.admin && (
                        <span className='font-normal text-muted-foreground'>
                            {' '}
                            · модератор
                        </span>
                    )}
                    {seller.banned && (
                        <span className='font-normal text-destructive'>
                            {' '}
                            · заблоковано
                        </span>
                    )}
                </p>
                <SellerLists seller={seller} />
                <p className='text-sm text-muted-foreground'>
                    {seller.usdRate === null
                        ? 'курс не вказано'
                        : `курс ${seller.usdRate.toLocaleString('uk-UA')} ₴ за $1`}
                    {' · з нами з '}
                    {formatDate(seller.createdAt)}
                    {' · останній вхід '}
                    {formatDate(seller.lastLoginAt)}
                </p>
            </div>
            <div className='flex flex-wrap gap-2'>
                <Button size='sm' variant='outline' onClick={onShowLists}>
                    <List />
                    Показати списки
                </Button>
                {!seller.admin && (
                    <BanButton
                        banned={seller.banned}
                        username={seller.username}
                        disabled={busy}
                        onToggle={(banned) =>
                            act(() => setBanned(seller.id, banned))
                        }
                    />
                )}
            </div>
        </li>
    );
}

// "2 схвалені · 1 на перевірці", leaving out states with none; "списків немає" without any.
function SellerLists({ seller }: { seller: ModeratedSeller }) {
    const { pending, approved, rejected } = seller.lists;
    const parts = [
        approved > 0 && {
            text: `схвалено ${approved}`,
            className: 'text-emerald-700 dark:text-emerald-400'
        },
        pending > 0 && {
            text: `на перевірці ${pending}`,
            className: 'text-amber-700 dark:text-amber-400'
        },
        rejected > 0 && {
            text: `відхилено ${rejected}`,
            className: 'text-destructive'
        }
    ].filter((p) => p !== false);
    return (
        <p className='text-sm text-muted-foreground'>
            {parts.length === 0
                ? 'списків немає'
                : parts.map((p, i) => (
                      <span key={p.text}>
                          {i > 0 && ' · '}
                          <span className={p.className}>{p.text}</span>
                      </span>
                  ))}
        </p>
    );
}
