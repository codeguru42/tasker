import { createGhSession, forgeEnvironment } from "../../github/forge-session.js";
import { ciStatus } from "./ci.js";
import { createPr, isPrMerged, listOpenPrs, mergePr } from "./pr.js";
import type { ForgeProvider } from "../provider.js";

export function createGitHubForge(account: string): ForgeProvider {
  const session = createGhSession(account);
  return {
    id: "github",
    account,
    ciStatus: (sha, cwd, env) => ciStatus(session, sha, cwd, forgeEnvironment(env)),
    isPrMerged: (prNumber, cwd, env) => isPrMerged(session, prNumber, cwd, forgeEnvironment(env)),
    listOpenPrs: (target, env) => listOpenPrs(session, target, forgeEnvironment(env)),
    createPr: (target, env) => createPr(session, target, forgeEnvironment(env)),
    mergePr: (prNumber, method, headSha, cwd, env) =>
      mergePr(session, prNumber, method, headSha, cwd, forgeEnvironment(env)),
  };
}
