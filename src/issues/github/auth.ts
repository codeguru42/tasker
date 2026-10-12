import { asciiFold } from "../../issue-key/github.js";
import { GhError, GhLoginError, GhNotInstalledError, runGh } from "./run.js";

// The result of authStatus(). login is the login that the token of the account belongs to.
// needsLogin is true only when a new login is the fix: a failed token call, an empty login,
// another login, or a 401 of gh api user.
export interface AuthStatus {
  ok: boolean;
  login?: string;
  detail: string;
  needsLogin: boolean;
}

// A 401 of the gh api user call: the token is not valid.
function isUnauthorized(error: GhError): boolean {
  return (
    error.subcommand === "api user" && error.exitCode === 1 && error.stderr.includes("(HTTP 401)")
  );
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
    if (error instanceof GhLoginError) {
      return { ok: false, detail: error.message, needsLogin: true };
    }
    if (error instanceof GhError) {
      return { ok: false, detail: error.message, needsLogin: isUnauthorized(error) };
    }
    if (error instanceof GhNotInstalledError) {
      return { ok: false, detail: error.message, needsLogin: false };
    }
    throw error;
  }
  const login = stdout.trim();
  if (login === "") {
    return {
      ok: false,
      detail: `gh api user gave no login for the account ${account}`,
      needsLogin: true,
    };
  }
  if (asciiFold(login) === asciiFold(account)) {
    return { ok: true, login, detail: `gh is logged in as ${login}`, needsLogin: false };
  }
  return {
    ok: false,
    login,
    detail: `the token of the account ${account} is for the login ${login}`,
    needsLogin: true,
  };
}
