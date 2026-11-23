import { Moderation } from '@/components/lists/moderation';
import {
    Loading,
    Notice,
    PageLayout,
    SERVER_ERROR
} from '@/components/layout/page-layout';
import { useAccount } from '@/hooks/use-account';

// /admin: moderators (ADMIN_TELEGRAM_IDS) approve or reject submitted lists, and ban traders. Approving reads the
// list at once; approved lists can be read again on demand, all of them or the ones ticked. The search finds lists in
// any state, by seller, title or link, and shows them in place of the tab; on the "Продавці" tab it finds sellers.
export function AdminPage() {
    const auth = useAccount();
    return (
        <PageLayout title='Модерація списків'>
            {auth === undefined ? (
                <Loading />
            ) : auth === null ? (
                <Notice tone='error'>{SERVER_ERROR}</Notice>
            ) : auth.user?.admin ? (
                <Moderation />
            ) : (
                <Notice>
                    Ця сторінка лише для модераторів.{' '}
                    {!auth.user && (
                        <a href='/lists' className='text-primary underline'>
                            Увійти
                        </a>
                    )}
                </Notice>
            )}
        </PageLayout>
    );
}
