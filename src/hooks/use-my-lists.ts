import { useEffect, useState } from 'react';
import type { MyLists, SubmittedLists } from '@/shared/account';
import { SERVER_ERROR } from '@/components/layout/page-layout';
import {
    ApiError,
    deleteList,
    fetchMyLists,
    setDefaultRate,
    setListRate,
    submitLists
} from '@/lib/account-api';

export const NO_LINKS =
    'Тут немає посилань на списки MTGGoldfish, ManaBox або Moxfield. Скопіюйте адресу сторінки зі списком або все повідомлення з посиланнями.';

// A trader's own lists (/lists), loaded once, and the changes they can make to them. Each change applies to the
// latest state, not the one it started from, so requests that finish out of order can't undo each other (two
// deletes in a row mustn't bring the first list back). An expired session (401) starts over from the sign-in; any
// other failure is the server's, and shows as `error` until the next change.
export function useMyLists() {
    // undefined while loading, null if loading failed
    const [data, setData] = useState<MyLists | null>();
    const [error, setError] = useState<string | null>(null);

    const fail = (err: unknown) => {
        if (err instanceof ApiError && err.status === 401) location.reload();
        else setError(SERVER_ERROR);
    };

    useEffect(() => {
        fetchMyLists()
            .then(setData)
            .catch((err) => {
                setData(null);
                fail(err);
            });
    }, []);

    // Runs a change, clearing the last error first; false when it failed.
    const change = async (run: () => Promise<void>) => {
        setError(null);
        try {
            await run();
            return true;
        } catch (err) {
            if (err instanceof ApiError && err.code === 'no-links')
                setError(NO_LINKS);
            else fail(err);
            return false;
        }
    };

    return {
        data,
        error,

        // Adds every list linked in `text`: one link, or a whole post with several (the way traders share their
        // lists in Telegram groups). What it did, or null when it failed.
        async add(text: string): Promise<SubmittedLists | null> {
            let result: SubmittedLists | null = null;
            await change(async () => {
                const submitted = await submitLists(text);
                result = submitted;
                setData(
                    (d) =>
                        d && { ...d, lists: [...submitted.added, ...d.lists] }
                );
            });
            return result;
        },

        remove: (id: number) =>
            change(async () => {
                await deleteList(id);
                setData(
                    (d) =>
                        d && { ...d, lists: d.lists.filter((l) => l.id !== id) }
                );
            }),

        saveDefaultRate: (usdRate: number | null) =>
            change(async () => {
                await setDefaultRate(usdRate);
                setData((d) => d && { ...d, usdRate });
            }),

        saveListRate: (id: number, usdRate: number | null) =>
            change(async () => {
                const list = await setListRate(id, usdRate);
                setData(
                    (d) =>
                        d && {
                            ...d,
                            lists: d.lists.map((l) => (l.id === id ? list : l))
                        }
                );
            })
    };
}
