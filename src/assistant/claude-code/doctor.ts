import type { Check } from "../../doctor/check.js";
import { timedCheck } from "../../doctor/timed-check.js";
import { childEnv } from "../../process/child-env.js";
import { assistantModelCheck } from "../model-check.js";
import { programVersionCheck } from "../program-check.js";
import { isOnPath } from "./sandbox.js";

// The detail when claude cannot start because it is missing or not on PATH.
export const CLAUDE_NOT_INSTALLED = "claude is not installed or not on PATH";

// Only a missing claude gets the fix, because only an install fixes that cause.
export function claudeVersionCheck(timeoutMs = 5000): Check {
  return programVersionCheck({
    program: "claude",
    notInstalled: CLAUDE_NOT_INSTALLED,
    remediation: "Install Claude Code and put claude on PATH.",
    timeoutMs,
  });
}

// The model forms have one home, modelIssue().
export function claudeModelCheck(model: string): Check {
  return assistantModelCheck("claude-code", `claude model: ${model}`, model);
}

// A program that the sandbox needs on Linux. Only the missing program gets the fix, with its package.
export function sandboxProgramCheck(program: string, pkg: string, timeoutMs = 1000): Check {
  return timedCheck({ name: `sandbox: ${program}`, required: true, timeoutMs }, async (env) =>
    isOnPath(program, childEnv(env, []))
      ? { status: "ok", detail: `${program} is on PATH` }
      : {
          status: "error",
          detail: `${program} is not on PATH`,
          remediation: `Install the ${pkg} package and put ${program} on PATH.`,
        },
  );
}
