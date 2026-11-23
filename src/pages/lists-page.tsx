import { useEffect, useState } from 'react';
import type { LoginFailure } from '@/shared/account';
import { TelegramIcon } from '@/components/icons';
import { PrivacyNote } from '@/components/lists/account';
import { TraderLists } from '@/components/lists/trader-lists';
import {
    Loading,
    Notice,
    PageLayout,
    SERVER_ERROR
} from '@/components/layout/page-layout';
import { Button } from '@/components/ui/button';
import { useAccount } from '@/hooks/use-account';

const LOGIN_FAILURES: Record<LoginFailure, string> = {
    cancelled: 'Вхід скасовано.',
    expired: 'Вхід не завершився вчасно. Спробуйте ще раз.',
    failed: 'Не вдалося увійти через Telegram. Спробуйте ще раз трохи згодом.',
    'no-username':
        'У вашому акаунті Telegram немає імені користувача (@username). Додайте його в налаштуваннях Telegram і увійдіть знову: без нього покупці не зможуть вам написати.',
    banned: 'Ваш акаунт заблоковано.',
    busy: 'Забагато спроб входу. Спробуйте ще раз за кілька хвилин.'
};

// /lists, "Мої списки": traders sign in with Telegram and add their MTGGoldfish, ManaBox or Moxfield lists, which show in
// search once a moderator approves them. The sign-in comes back here, with ?login=<reason> when it failed.
export function ListsPage() {
    const auth = useAccount();
    // read once, then dropped from the address bar so a reload doesn't show it again
    // Only a reason we know: the address is anyone's to edit, and `?login=constructor` would otherwise find
    // Object's own properties.
    const [loginFailure] = useState(() => {
        const reason = new URLSearchParams(location.search).get('login');
        return reason !== null && Object.hasOwn(LOGIN_FAILURES, reason)
            ? (reason as LoginFailure)
            : null;
    });
    useEffect(() => {
        if (new URLSearchParams(location.search).has('login'))
            history.replaceState(null, '', location.pathname);
    }, []);

    return (
        <PageLayout title='Списки продавців'>
            {loginFailure && (
                <Notice tone='error'>{LOGIN_FAILURES[loginFailure]}</Notice>
            )}
            {auth === undefined ? (
                <Loading />
            ) : auth === null ? (
                <Notice tone='error'>{SERVER_ERROR}</Notice>
            ) : auth.user ? (
                <TraderLists user={auth.user} />
            ) : (
                <SignIn enabled={auth.loginEnabled} />
            )}
        </PageLayout>
    );
}

function SignIn({ enabled }: { enabled: boolean }) {
    return (
        <section className='grid gap-4'>
            <p className='leading-relaxed'>
                Продаєте карти в Telegram-групах? Додайте свій список із{' '}
                <b>MTGGoldfish</b>, <b>ManaBox</b> або <b>Moxfield</b>: після
                перевірки модератором карти з нього з’являться в результатах
                пошуку разом із вашим Telegram, щоб покупці могли вам написати.
            </p>
            {enabled ? (
                <Button asChild size='lg' className='justify-self-start'>
                    <a href='/api/auth/login'>
                        <TelegramIcon className='size-5' />
                        Увійти через Telegram
                    </a>
                </Button>
            ) : (
                <Notice>Вхід тимчасово недоступний.</Notice>
            )}
            <PrivacyNote />
        </section>
    );
}
