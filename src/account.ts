// What the account routes answer: types only. Shared between server and frontend — keep free of server-only imports.

// The signed-in user, as the page shows them.
export type CurrentUser = {
    username: string; // Telegram username, without the @
    displayName: string;
    admin: boolean; // may moderate lists
};

// GET /api/auth/me. `loginEnabled` is false when the server has no Telegram bot configured, so the page hides
// the sign-in button.
export type AuthState = {
    user: CurrentUser | null;
    loginEnabled: boolean;
};

// Why a sign-in failed: /lists?login=<reason>, where the callback sends the user back.
export type LoginFailure =
    | 'cancelled' // the user went back without signing in
    | 'expired' // the sign-in took too long, or was started in another browser
    | 'failed' // Telegram's answer didn't check out, or Telegram was unreachable
    | 'no-username' // the Telegram account has no username, so buyers couldn't contact it
    | 'banned';

// Where a list is kept.
export type ListSource = 'mtggoldfish' | 'manabox';

// Every list waits for a moderator; only approved ones are read and shown in search.
export type ListStatus = 'pending' | 'approved' | 'rejected';

// A trader's list, as its owner sees it.
export type MyList = {
    id: number;
    source: ListSource;
    url: string; // the list as people open it
    title: string | null; // the list's own name, once it has been read
    status: ListStatus;
    createdAt: number;
    fetchedAt: number | null; // its last successful refresh
    cardCount: number; // copies, from that refresh
    lastError: ListRefreshError | null; // why the last refresh failed, when it did
};

// Why a list's last refresh failed. The cards from the refresh before stay in search meanwhile.
export type ListRefreshError =
    | 'not-found' // the source says there's no such list: deleted, or made private
    | 'unreadable' // the page doesn't have the list where it used to (the source changed its pages)
    | 'too-large' // more rows than a list may have (MAX_LIST_ROWS)
    | 'unavailable'; // the source or Scryfall didn't answer; tried again later

// GET /api/lists: the user's lists, newest first, and how many they may have.
export type MyLists = { lists: MyList[]; max: number };

// Why POST /api/lists refused a link.
export type SubmitListError =
    | 'invalid-link' // not an MTGGoldfish or ManaBox list
    | 'taken' // this list was added before, by this user or another
    | 'too-many'; // the user has `max` lists already

// A list in the moderation queue, with its owner (GET /api/admin/lists?status=…).
export type ModeratedList = MyList & {
    reviewedAt: number | null;
    owner: {
        id: number;
        username: string;
        displayName: string;
        banned: boolean;
    };
};
