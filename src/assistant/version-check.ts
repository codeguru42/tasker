import { detailSuffix } from "../detail-suffix.js";
import type { Check } from "../doctor/check.js";
import { firstLine } from "../doctor/first-line.js";
import { timedCheck } from "../doctor/timed-check.js";
import { childEnv } from "../process/child-env.js";
import { CommandNotFoundError, runChild } from "../process/run-child.js";

export interface VersionCheckSpec {
  program: string;
  notInstalled: string;
  remediation: string;
  timeoutMs: number;
}

// Only a missing program gets the fix, because only an install fixes that cause.
export function programVersionCheck(spec: VersionCheckSpec): Check {
  const { program, notInstalled, remediation, timeoutMs } = spec;
  return timedCheck({ name: `${program} version`, required: true, timeoutMs }, async (env, { signal }) => {
    let child;
    try {
      child = await runChild(program, ["--version"], { env: childEnv(env, []), signal });
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        return { status: "error", detail: notInstalled, remediation };
      }
      throw error;
    }
    if (child.signal !== null) {
      return { status: "error", detail: `${program} --version was killed by ${child.signal}` };
    }
    if (child.code !== 0) {
      const stderr = firstLine(child.stderr);
      return {
        status: "error",
        detail: `${program} --version exited ${String(child.code)}${detailSuffix(stderr)}`,
      };
    }
    return { status: "ok", detail: firstLine(child.stdout) };
  });
}
