import { detailSuffix } from "../../detail-suffix.js";
import type { Check } from "../../doctor/check.js";
import { firstLine } from "../../doctor/first-line.js";
import { timedCheck } from "../../doctor/timed-check.js";
import { childEnv } from "../../process/child-env.js";
import { CommandNotFoundError, runChild } from "../../process/run-child.js";
import { modelIssue } from "../models.js";
import { isOnPath } from "./sandbox.js";

// The detail when claude cannot start because it is missing or not on PATH.
export const CLAUDE_NOT_INSTALLED = "claude is not installed or not on PATH";

// Only a missing claude gets the fix, because only an install fixes that cause.
export function claudeVersionCheck(timeoutMs = 5000): Check {
  return timedCheck({ name: "claude version", required: true, timeoutMs }, async (env, { signal }) => {
    let child;
    try {
      child = await runChild("claude", ["--version"], { env: childEnv(env, []), signal });
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        return {
          status: "error",
          detail: CLAUDE_NOT_INSTALLED,
          remediation: "Install Claude Code and put claude on PATH.",
        };
      }
      throw error;
    }
    if (child.signal !== null) {
      return { status: "error", detail: `claude --version was killed by ${child.signal}` };
    }
    if (child.code !== 0) {
      const stderr = firstLine(child.stderr);
      return {
        status: "error",
        detail: `claude --version exited ${String(child.code)}${detailSuffix(stderr)}`,
      };
    }
    return { status: "ok", detail: firstLine(child.stdout) };
  });
}

// The model forms have one home, modelIssue().
export function claudeModelCheck(model: string): Check {
  return timedCheck({ name: `claude model: ${model}`, required: true, timeoutMs: 1000 }, async () => {
    const issue = modelIssue("claude-code", model);
    return issue === undefined
      ? { status: "ok", detail: `${model} is a claude-code model` }
      : { status: "error", detail: issue };
  });
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
