import { timedCheck } from "../../doctor/timed-check.js";
import type { AssistantProvider, RunInput, RunOutcome } from "../provider.js";
import { modelIssue } from "../models.js";
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
    modelChecks: (model) => [
      timedCheck({ name: `pi model: ${model}`, required: true, timeoutMs: 1000 }, async () => {
        const issue = modelIssue("pi", model);
        return issue === undefined
          ? { status: "ok", detail: `${model} is a pi model` }
          : { status: "error", detail: issue };
      }),
    ],
    detectQuotaApprovalWarning: () => undefined,
    isQuotaEvent: () => false,
    shouldSuppressQuotaApprovalPause: () => false,
  };
}
