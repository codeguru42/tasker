import { asciiFold } from "../../issue-key/github.js";
import { runGh } from "./run.js";

// The result of authStatus(). login is the login that the token of the account belongs to.
export interface AuthStatus {
  ok: boolean;
  login?: string;
  detail: string;
}

// Tells whether gh is logged in as account. It asks GitHub for the login of the token of the
// account. The login must equal the account, with the ASCII-only fold of GitHub names.
// signal stops gh and rejects with an AbortError.
export async function authStatus(
  account: string,
  env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal } = {},
): Promise<AuthStatus> {
  const stdout = await runGh(["api", "user", "--jq", ".login"], {
    account,
    env,
    signal: options.signal,
  });
  const login = stdout.trim();
  if (asciiFold(login) === asciiFold(account)) {
    return { ok: true, login, detail: `gh is logged in as ${login}` };
  }
  return {
    ok: false,
    login,
    detail: `the token of the account ${account} is for the login ${login}`,
  };
}
