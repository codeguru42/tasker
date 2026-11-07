import type { AssistantProvider, RunInput, RunOutcome } from "../provider.js";
import { assistantModelCheck } from "../model-check.js";
import { piChildEnv } from "./child-env.js";
import { piDoctorChecks } from "./doctor.js";

function refused(input: RunInput, reason: string): RunOutcome {
  return {
    kind: "failure",
    sessionId: input.sessionId,
    events: [],
    permissionDenials: [],
    usage: "unavailable",
    exitCode: null,
    signal: null,
    reason,
  };
}

export function createPiProvider(): AssistantProvider {
  return {
    id: "pi",
    async run(input) {
      const childEnvironment = piChildEnv(input.env);
      const reason =
        "reason" in childEnvironment ? childEnvironment.reason : "the pi assistant cannot run a task in this version";
      return refused(input, reason);
    },
    doctorChecks: (repos) => piDoctorChecks(repos),
    modelChecks: (model) => [assistantModelCheck("pi", `pi model: ${model}`, model)],
    detectQuotaApprovalWarning: () => undefined,
    isQuotaEvent: () => false,
    shouldSuppressQuotaApprovalPause: () => false,
  };
}
