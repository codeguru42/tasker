import { detailSuffix } from "../../detail-suffix.js";
import type { Check } from "../../doctor/check.js";
import { firstLine } from "../../doctor/first-line.js";
import { timedCheck } from "../../doctor/timed-check.js";
import { childEnv } from "../../process/child-env.js";
import { CommandNotFoundError, runChild } from "../../process/run-child.js";
import { programVersionCheck } from "../version-check.js";

const CODEX_NOT_INSTALLED = "codex is not installed or not on PATH";
const CODEX_INSTALL_FIX = "Install Codex and put codex on PATH.";

// The exit code and the stderr text of `codex login status` with no login.
const LOGGED_OUT_EXIT_CODE = 1;
const LOGGED_OUT_TEXT = "Not logged in";

export function codexVersionCheck(timeoutMs = 5000): Check {
  return programVersionCheck({
    program: "codex",
    notInstalled: CODEX_NOT_INSTALLED,
    remediation: CODEX_INSTALL_FIX,
    timeoutMs,
  });
}

// Only a missing codex and a missing login get a fix, because only that fix removes the cause.
export function codexLoginCheck(timeoutMs = 5000): Check {
  return timedCheck({ name: "codex login", required: true, timeoutMs }, async (env, { signal }) => {
    let child;
    try {
      child = await runChild("codex", ["login", "status"], { env: childEnv(env, []), signal });
    } catch (error) {
      if (error instanceof CommandNotFoundError) {
        return { status: "error", detail: CODEX_NOT_INSTALLED, remediation: CODEX_INSTALL_FIX };
      }
      throw error;
    }
    if (child.signal !== null) {
      return { status: "error", detail: `codex login status was killed by ${child.signal}` };
    }
    if (child.code === 0) {
      return { status: "ok", detail: "codex is logged in" };
    }
    if (child.code === LOGGED_OUT_EXIT_CODE && child.stderr.includes(LOGGED_OUT_TEXT)) {
      return { status: "error", detail: "codex is not logged in", remediation: "Run codex login." };
    }
    return {
      status: "error",
      detail: `codex login status exited ${String(child.code)}${detailSuffix(firstLine(child.stderr))}`,
    };
  });
}
