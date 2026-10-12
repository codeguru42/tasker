import { asciiFold } from "../../issue-key/github.js";
import { GhError, GhLoginError, GhNotInstalledError, runGh } from "./run.js";

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
  let stdout: string;
  try {
    stdout = await runGh(["api", "user", "--jq", ".login"], {
      account,
      env,
      signal: options.signal,
    });
  } catch (error) {
    // These messages never hold the token. A GhError has *** in place of it.
    if (
      error instanceof GhLoginError ||
      error instanceof GhError ||
      error instanceof GhNotInstalledError
    ) {
      return { ok: false, detail: error.message };
    }
    throw error;
  }
  const login = stdout.trim();
  if (login === "") {
    return { ok: false, detail: `gh api user gave no login for the account ${account}` };
  }
  if (asciiFold(login) === asciiFold(account)) {
    return { ok: true, login, detail: `gh is logged in as ${login}` };
  }
  return {
    ok: false,
    login,
    detail: `the token of the account ${account} is for the login ${login}`,
  };
}
