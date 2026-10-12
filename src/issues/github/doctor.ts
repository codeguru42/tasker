import type { Check } from "../../doctor/check.js";
import { timedCheck } from "../../doctor/timed-check.js";
import { GhNotInstalledError, readGhVersion } from "./run.js";

// Before this version, gh auth token has no --user flag.
const MINIMUM_GH = { major: 2, minor: 40, patch: 0 };
const MINIMUM_TEXT = `${MINIMUM_GH.major}.${MINIMUM_GH.minor}.${MINIMUM_GH.patch}`;

export function ghVersionCheck(timeoutMs = 5000): Check {
  const remediation = `Install gh ${MINIMUM_TEXT} or newer.`;
  return timedCheck({ name: "gh version", required: true, timeoutMs }, async (env, { signal }) => {
    let output: string;
    try {
      output = await readGhVersion(env, { signal });
    } catch (error) {
      if (error instanceof GhNotInstalledError) {
        return {
          status: "error",
          detail: `gh is not installed. tasker needs gh ${MINIMUM_TEXT} or newer.`,
          remediation,
        };
      }
      throw error;
    }
    const firstLine = output.split("\n")[0].replace(/\r$/, "");
    const match = /^gh version (\d+)\.(\d+)\.(\d+)(\S*)/.exec(firstLine);
    if (match === null) {
      return { status: "error", detail: `cannot read the gh version from: ${firstLine}` };
    }
    const found = firstLine.slice("gh version ".length).split(" ")[0];
    const [major, minor, patch] = [match[1], match[2], match[3]].map(Number);
    const older =
      major !== MINIMUM_GH.major
        ? major < MINIMUM_GH.major
        : minor !== MINIMUM_GH.minor
          ? minor < MINIMUM_GH.minor
          : patch < MINIMUM_GH.patch;
    if (older) {
      return {
        status: "error",
        detail: `gh ${found} is older than the minimum ${MINIMUM_TEXT}. Before ${MINIMUM_TEXT}, gh auth token has no --user flag.`,
        remediation,
      };
    }
    return { status: "ok", detail: `gh ${found} (minimum ${MINIMUM_TEXT})` };
  });
}
