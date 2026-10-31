import type { AuthStatus } from "../provider.js";
import { AcliBinError, AcliNotInstalledError } from "./run.js";
import { activeSite, JiraLoginError } from "./site.js";

// Reads the state of the login of acli from activeSite(). login is the active site.
// A missing acli or a bad TASKER_ACLI_BIN gives ok false and needsLogin false.
// Each other error passes through, also an AbortError.
export async function authStatus(env: NodeJS.ProcessEnv, options: { signal?: AbortSignal } = {}): Promise<AuthStatus> {
  try {
    const site = await activeSite(env, options);
    return { ok: true, login: site, detail: `acli uses the site ${site}`, needsLogin: false };
  } catch (error) {
    if (error instanceof JiraLoginError) return { ok: false, detail: error.message, needsLogin: true };
    if (error instanceof AcliNotInstalledError || error instanceof AcliBinError) {
      return { ok: false, detail: error.message, needsLogin: false };
    }
    throw error;
  }
}
