// The result of authStatus(). login is the login that the token of the account belongs to.
// needsLogin is true only when a new login is the fix: a failed token call, an empty login,
// another login, or a 401 of gh api user.
export interface AuthStatus {
  ok: boolean;
  login?: string;
  detail: string;
  needsLogin: boolean;
}
