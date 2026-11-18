import type {
    AuthState,
    ListStatus,
    ListsRefreshed,
    ModeratedList,
    ModeratedSeller,
    MyList,
    MyLists,
    SubmittedLists
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
// Deletes the account with its lists, and signs out.
export const deleteAccount = () =>
    api<void>('/api/auth/me', { method: 'DELETE' });

export const fetchMyLists = () => api<MyLists>('/api/lists');
// Every list linked in `text`, one link or a whole message. Throws ApiError with `code` 'no-links' when it has none.
export const submitLists = (text: string) =>
    api<SubmittedLists>('/api/lists', { body: { text } });
export const deleteList = (id: number) =>
    api<void>(`/api/lists/${id}`, { method: 'DELETE' });
// exchange rates, UAH per USD; null clears one
export const setDefaultRate = (usdRate: number | null) =>
    api<void>('/api/lists/rate', { body: { usdRate } });
export const setListRate = (id: number, usdRate: number | null) =>
    api<MyList>(`/api/lists/${id}`, { method: 'PATCH', body: { usdRate } });

export const fetchQueue = (status: ListStatus) =>
    api<ModeratedList[]>(`/api/admin/lists?status=${status}`);
// every seller, or those matching by name or @username
export const fetchSellers = (query: string) =>
    api<ModeratedSeller[]>(
        `/api/admin/sellers?${new URLSearchParams({ q: query })}`
    );
// lists in any state, by seller, title or link
export const searchLists = (query: string) =>
    api<ModeratedList[]>(
        `/api/admin/lists?${new URLSearchParams({ q: query })}`
    );
export const reviewList = (id: number, status: 'approved' | 'rejected') =>
    api<void>(`/api/admin/lists/${id}`, { body: { status } });
// `ids` of approved lists, or every approved list
export const refreshLists = (ids: number[] | 'all') =>
    api<ListsRefreshed>('/api/admin/refresh', {
        body: ids === 'all' ? { all: true } : { ids }
    });
export const setBanned = (userId: number, banned: boolean) =>
    api<void>(`/api/admin/users/${userId}`, { body: { banned } });
