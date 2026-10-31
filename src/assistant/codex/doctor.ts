import type { Check } from "../../doctor/check.js";
import { programCheck, programVersionCheck } from "../program-check.js";

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
  return programCheck({
    name: "codex login",
    program: "codex",
    args: ["login", "status"],
    notInstalled: CODEX_NOT_INSTALLED,
    remediation: CODEX_INSTALL_FIX,
    timeoutMs,
    readChild: (child, exitDetail) => {
      if (child.code === 0) {
        return { status: "ok", detail: "codex is logged in" };
      }
      if (child.code === LOGGED_OUT_EXIT_CODE && child.stderr.includes(LOGGED_OUT_TEXT)) {
        return { status: "error", detail: "codex is not logged in", remediation: "Run codex login." };
      }
      return { status: "error", detail: exitDetail };
    },
  });
}
