import { ArrowRight, Store } from 'lucide-react';
import { TelegramIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';

// On the landing page, under the card list: invites people who sell in Telegram groups to add their lists (/lists),
// whose cards then show in search under "Гравці". Sellers who already have an account sign in straight away:
// the sign-in comes back to /lists.
export function SellerInvite() {
    return (
        <section className='flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-dashed bg-card/50 p-4 sm:flex-row sm:items-center sm:p-5'>
            <Store className='hidden size-6 shrink-0 text-primary sm:block' />
            <div className='grid gap-1'>
                <h2 className='font-semibold'>Продаєте карти в Telegram?</h2>
                <p className='text-sm leading-relaxed text-muted-foreground'>
                    Додайте свій список — покупці знайдуть ваші карти тут, поруч
                    із магазинами.
                </p>
                <p className='text-sm text-muted-foreground'>
                    Уже маєте акаунт?{' '}
                    <a
                        href='/api/auth/login'
                        className='inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline'
                    >
                        <TelegramIcon className='size-3.5' />
                        Увійти через Telegram
                    </a>
                </p>
            </div>
            <Button
                asChild
                variant='outline'
                className='shrink-0 self-start sm:ml-auto sm:self-center'
            >
                <a href='/lists'>
                    Додати список
                    <ArrowRight />
                </a>
            </Button>
        </section>
    );
}
