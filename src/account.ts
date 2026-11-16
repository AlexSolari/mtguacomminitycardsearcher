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
