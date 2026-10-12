import { userInfo } from "node:os";
import type { Check, CheckResult } from "../../doctor/check.js";
import type { GitVcsConfig } from "./provision.js";
import { GitNotInstalledError, runGit } from "./run.js";
import { hideSshKey, remoteCwd } from "./ssh.js";

const MINIMUM_GIT = { major: 2, minor: 20 };
const MINIMUM_TEXT = `${MINIMUM_GIT.major}.${MINIMUM_GIT.minor}`;

// A repo that the doctor checks. clone is the path of its bare clone.
export interface GitDoctorRepo {
  key: string;
  remote: string;
  clone: string;
  config: GitVcsConfig;
}

function timedOut(timeoutMs: number): CheckResult {
  return { status: "error", detail: `the check did not finish in ${timeoutMs} ms` };
}

interface CheckSpec {
  name: string;
  required: boolean;
  timeoutMs: number;
  sshKey: string | undefined;
}

// The one place that makes the signal, catches the errors and hides the ssh key.
// run() never rejects. A timeout gives the timeout result, with no partial result.
function makeCheck(
  spec: CheckSpec,
  body: (
    env: NodeJS.ProcessEnv,
    limit: { signal: AbortSignal; deadline: number },
  ) => Promise<CheckResult>,
): Check {
  return {
    name: spec.name,
    required: spec.required,
    timeoutMs: spec.timeoutMs,
    async run(env) {
      const signal = AbortSignal.timeout(spec.timeoutMs);
      const deadline = Date.now() + spec.timeoutMs;
      let result: CheckResult;
      try {
        result = await body(env, { signal, deadline });
      } catch (error) {
        result = signal.aborted
          ? timedOut(spec.timeoutMs)
          : { status: "error", detail: error instanceof Error ? error.message : String(error) };
      }
      if (signal.aborted && result.status !== "error") {
        result = timedOut(spec.timeoutMs);
      }
      const hide = (text: string) => hideSshKey(text, spec.sshKey, userInfo().homedir);
      return {
        ...result,
        detail: hide(result.detail),
        ...(result.remediation === undefined ? {} : { remediation: hide(result.remediation) }),
      };
    },
  };
}

export function gitVersionCheck(timeoutMs = 5000): Check {
  const remediation = `Install git ${MINIMUM_TEXT} or newer.`;
  return makeCheck(
    { name: "git version", required: true, timeoutMs, sshKey: undefined },
    async (env, { signal }) => {
      let output: string;
      try {
        output = await runGit(["version"], { cwd: remoteCwd(), env, signal });
      } catch (error) {
        if (error instanceof GitNotInstalledError) {
          return {
            status: "error",
            detail: `git is not installed. tasker needs git ${MINIMUM_TEXT} or newer.`,
            remediation,
          };
        }
        throw error;
      }
      const firstLine = output.split("\n")[0].replace(/\r$/, "");
      const match = /^git version (\d+)\.(\d+)\S*/.exec(firstLine);
      if (match === null) {
        return { status: "error", detail: `cannot read the git version from: ${firstLine}` };
      }
      const found = firstLine.slice("git version ".length).split(" ")[0];
      const major = Number(match[1]);
      const minor = Number(match[2]);
      if (major < MINIMUM_GIT.major || (major === MINIMUM_GIT.major && minor < MINIMUM_GIT.minor)) {
        return {
          status: "error",
          detail: `git ${found} is older than the minimum ${MINIMUM_TEXT}.`,
          remediation,
        };
      }
      return { status: "ok", detail: `git ${found} (minimum ${MINIMUM_TEXT})` };
    },
  );
}
