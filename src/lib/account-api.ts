import type {
    AuthState,
    ListStatus,
    ModeratedList,
    MyList,
    MyLists
} from '@/account';

// The account and lists API (server/auth/auth-route.ts, server/lists-route.ts). A failed request throws
// ApiError, whose `code` is the server's `error` when it sent one.

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string | null
    ) {
        super(code ?? `HTTP ${status}`);
    }
}

async function api<T>(
    path: string,
    init: { method?: string; body?: unknown } = {}
): Promise<T> {
    const res = await fetch(path, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers:
            init.body === undefined
                ? undefined
                : { 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
            error?: unknown;
        } | null;
        throw new ApiError(
            res.status,
            typeof body?.error === 'string' ? body.error : null
        );
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
}

export const fetchAuth = () => api<AuthState>('/api/auth/me');
export const logout = () => api<void>('/api/auth/logout', { method: 'POST' });

export const fetchMyLists = () => api<MyLists>('/api/lists');
// Throws ApiError with a SubmitListError `code` when the link is refused.
export const submitList = (link: string) =>
    api<MyList>('/api/lists', { body: { link } });
export const deleteList = (id: number) =>
    api<void>(`/api/lists/${id}`, { method: 'DELETE' });

export const fetchQueue = (status: ListStatus) =>
    api<ModeratedList[]>(`/api/admin/lists?status=${status}`);
export const reviewList = (id: number, status: 'approved' | 'rejected') =>
    api<void>(`/api/admin/lists/${id}`, { body: { status } });
export const setBanned = (userId: number, banned: boolean) =>
    api<void>(`/api/admin/users/${userId}`, { body: { banned } });
