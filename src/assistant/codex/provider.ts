import type { AssistantProvider } from "../provider.js";
import { codexLoginCheck, codexVersionCheck } from "./doctor.js";

// The provider lets a repo name codex and gives the doctor checks of Codex. It starts no child:
// each run gives a failure, because a later ticket builds the run of a task under Codex.
export function createCodexProvider(): AssistantProvider {
  return {
    id: "codex",
    run: async (input) => ({
      kind: "failure",
      sessionId: input.sessionId,
      events: [],
      permissionDenials: [],
      usage: "unavailable",
      exitCode: null,
      signal: null,
      reason: "the codex assistant cannot run a task in this version",
    }),
    doctorChecks: (repos) => (repos.length === 0 ? [] : [codexVersionCheck(), codexLoginCheck()]),
    modelChecks: () => [],
    detectQuotaApprovalWarning: () => undefined,
    isQuotaEvent: () => false,
    shouldSuppressQuotaApprovalPause: () => false,
  };
}
