// The signed-in trader's account: who they are, what's stored about them, and deleting it.
import { useState } from 'react';
import { LogOut, ShieldCheck, UserX } from 'lucide-react';
import type { CurrentUser } from '@/shared/account';
import { Notice, SERVER_ERROR } from '@/components/layout/page-layout';
import { Button } from '@/components/ui/button';
import { deleteAccount, logout } from '@/lib/account-api';

// Who's signed in, the way out, and (for moderators) the way to the moderation page.
export function AccountBar({ user }: { user: CurrentUser }) {
    const [leaving, setLeaving] = useState(false);
    const signOut = () => {
        setLeaving(true);
        logout()
            .catch(() => {})
            .finally(() => location.reload());
    };
    return (
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3'>
            <p className='mr-auto min-w-0'>
                Ви увійшли як <b>{user.displayName}</b>{' '}
                <span className='text-muted-foreground'>@{user.username}</span>
            </p>
            {user.admin && (
                <Button asChild variant='outline' size='sm'>
                    <a href='/admin'>
                        <ShieldCheck />
                        Модерація
                    </a>
                </Button>
            )}
            <Button
                variant='ghost'
                size='sm'
                onClick={signOut}
                disabled={leaving}
            >
                <LogOut />
                Вийти
            </Button>
        </div>
    );
}

// What signing in stores, and how to remove it. The session cookie is the only cookie, and only signed-in
// traders get it.
export function PrivacyNote({ signedIn = false }: { signedIn?: boolean }) {
    return (
        <p className='text-xs leading-relaxed text-muted-foreground'>
            Що ми зберігаємо: ваш Telegram id, ім’я та @username (їх бачать
            покупці поруч із вашими картами), посилання на ваші списки й карти з
            них. Cookie ставимо лише для входу. Видалити все можна будь-коли
            {signedIn ? ' кнопкою нижче' : ' після входу'}.
        </p>
    );
}

// Deletes the account with its lists, after asking: there's no undo.
export function DeleteAccount() {
    const [deleting, setDeleting] = useState(false);
    const [failed, setFailed] = useState(false);
    const remove = async () => {
        if (
            !confirm(
                'Видалити акаунт? Усі ваші списки зникнуть із пошуку, а дані про вас буде стерто. Це не можна скасувати.'
            )
        )
            return;
        setDeleting(true);
        setFailed(false);
        try {
            await deleteAccount();
            location.reload();
        } catch {
            setFailed(true);
            setDeleting(false);
        }
    };
    return (
        <section className='grid gap-2 border-t pt-4'>
            <PrivacyNote signedIn />
            <Button
                variant='ghost'
                size='sm'
                onClick={remove}
                disabled={deleting}
                className='justify-self-start text-destructive hover:text-destructive'
            >
                <UserX />
                Видалити акаунт
            </Button>
            {failed && <Notice tone='error'>{SERVER_ERROR}</Notice>}
        </section>
    );
}
