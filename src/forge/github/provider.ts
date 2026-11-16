import { createGhSession } from "../../github/forge-session.js";
import { ciStatus } from "./ci.js";
import { changePrBase, createPr, isPrDraft, isPrMerged, listOpenPrs, markPrReady, mergePr } from "./pr.js";
import type { ForgeProvider } from "../provider.js";

export function createGitHubForge(account: string): ForgeProvider {
  const session = createGhSession(account);
  return {
    id: "github",
    account,
    ciStatus: (sha, cwd, env) => ciStatus(session, sha, cwd, env),
    isPrMerged: (prNumber, cwd, env) => isPrMerged(session, prNumber, cwd, env),
    listOpenPrs: (target, env) => listOpenPrs(session, target, env),
    createPr: (target, env) => createPr(session, target, env),
    mergePr: (prNumber, method, headSha, cwd, env) => mergePr(session, prNumber, method, headSha, cwd, env),
    changePrBase: (prNumber, base, cwd, env) => changePrBase(session, prNumber, base, cwd, env),
    isPrDraft: (prNumber, cwd, env) => isPrDraft(session, prNumber, cwd, env),
    markPrReady: (prNumber, cwd, env) => markPrReady(session, prNumber, cwd, env),
  };
}
