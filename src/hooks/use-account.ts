import { useEffect, useState } from 'react';
import type { AuthState } from '@/account';
import { fetchAuth } from '@/lib/account-api';

// Who's signed in: undefined while asking, null if the server couldn't be reached.
export function useAccount() {
    const [auth, setAuth] = useState<AuthState | null | undefined>();
    useEffect(() => {
        let live = true;
        fetchAuth()
            .then((state) => live && setAuth(state))
            .catch(() => live && setAuth(null));
        return () => {
            live = false;
        };
    }, []);
    return auth;
}
