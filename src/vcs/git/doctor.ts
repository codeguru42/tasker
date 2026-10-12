import { existsSync, realpathSync } from "node:fs";
import { userInfo } from "node:os";
import { relative } from "node:path";
import type { Check, CheckResult } from "../../doctor/check.js";
import type { GitVcsConfig } from "./provision.js";
import { GitError, GitNotInstalledError, runGit } from "./run.js";
import { hideSshKey, remoteCwd, remoteNotAnswering, runRemoteGit } from "./ssh.js";
import {
  DeadlineError,
  findStaleLocks,
  isInside,
  onceProcView,
  type ProcView,
} from "./stale-locks.js";
import { type SshAccount, sshAccount, sshTarget } from "./ssh-account.js";
import { withoutLineEnd } from "./worktree.js";

const MINIMUM_GIT = { major: 2, minor: 20 };
const MINIMUM_TEXT = `${MINIMUM_GIT.major}.${MINIMUM_GIT.minor}`;

// A repo that the doctor checks. clone is the path of its bare clone.
export interface GitDoctorRepo {
  key: string;
  remote: string;
  clone: string;
  config: GitVcsConfig;
}

// The result of the identity check and the lock-file check when the clone does not exist yet.
// Provision makes the clone and writes the identity at the first start, so this is not a problem.
const NO_CLONE: CheckResult = { status: "ok", detail: "no clone yet" };

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
        result =
          signal.aborted || error instanceof DeadlineError
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

// The value of a git configuration key in the clone, as a commit reads it (the clone, then the
// global files). An empty value and a missing value both give "".
async function configValue(
  clone: string,
  key: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<string> {
  try {
    return withoutLineEnd(await runGit(["config", "--get", key], { gitDir: clone, env, signal }));
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) {
      return "";
    }
    throw error;
  }
}

// Compares user.name and user.email that a commit in the clone gets with vcs.config.
// The check reads the git configuration only. A GIT_AUTHOR_NAME variable at commit time wins.
export function identityCheck(repo: GitDoctorRepo, timeoutMs = 5000): Check {
  return makeCheck(
    {
      name: `git identity: ${repo.key}`,
      required: false,
      timeoutMs,
      sshKey: repo.config.sshKey,
    },
    async (env, { signal }) => {
      // This test comes first, because git --git-dir <missing> reads the global value.
      if (!existsSync(repo.clone)) {
        return NO_CLONE;
      }
      const name = await configValue(repo.clone, "user.name", env, signal);
      const email = await configValue(repo.clone, "user.email", env, signal);
      const fields = [
        { option: "authorName", key: "user.name", want: repo.config.authorName, found: name },
        { option: "authorEmail", key: "user.email", want: repo.config.authorEmail, found: email },
      ];
      const mismatches = fields
        .filter((field) => field.want !== undefined && field.want !== field.found)
        .map((field) =>
          field.found === ""
            ? `vcs.config.${field.option} is "${field.want}", but a commit in the clone gets no ${field.key}`
            : `vcs.config.${field.option} is "${field.want}", but a commit in the clone gets "${field.found}"`,
        );
      if (mismatches.length > 0) {
        return {
          status: "warn",
          detail: mismatches.join("\n"),
          remediation:
            "Provision the clone again. Provision writes vcs.config.authorName and vcs.config.authorEmail to the clone configuration.",
        };
      }
      if (name === "" || email === "") {
        const missing = [name === "" ? "user.name" : "", email === "" ? "user.email" : ""]
          .filter((key) => key !== "")
          .join(" and ");
        return {
          status: "warn",
          detail: `a commit in the clone gets no ${missing}`,
          remediation:
            "Set vcs.config.authorName and vcs.config.authorEmail, or set a global git identity.",
        };
      }
      return { status: "ok", detail: `a commit in the clone gets ${name} <${email}>` };
    },
  );
}

function accountText(account: SshAccount): string {
  switch (account.state) {
    case "found":
      return `The remote sees the ssh account ${account.account}.`;
    case "none":
      return "The remote gives no ssh account name.";
    case "git-ssh":
      return "tasker does not read the ssh account when GIT_SSH is set.";
  }
}

function connectionRemediation(account: SshAccount | undefined): string {
  if (account === undefined) {
    return "Make sure that remote names the repo and that the remote answers.";
  }
  if (account.state === "found") {
    return `The remote sees the ssh account ${account.account}. If this account cannot see the repo, set vcs.config.sshKey to a key of an account that can. Else make sure that remote names the repo.`;
  }
  return "Make sure that vcs.config.sshKey names a key that the remote accepts. Then make sure that remote names the repo.";
}

// Asks the remote for HEAD. For an ssh remote, it also reads the ssh account that the remote sees,
// also when the first call fails, so the user can tell a wrong key from a wrong remote.
export function connectionCheck(repo: GitDoctorRepo, timeoutMs = 30000): Check {
  const { remote } = repo;
  const { sshKey } = repo.config;
  return makeCheck(
    { name: `git connection: ${repo.key}`, required: true, timeoutMs, sshKey },
    async (env, { signal }) => {
      let failure: GitError | undefined;
      try {
        await runRemoteGit(
          ["ls-remote", "--", remote, "HEAD"],
          { cwd: remoteCwd(), env, signal },
          sshKey,
        );
      } catch (error) {
        if (!(error instanceof GitError)) {
          throw error;
        }
        failure = error;
      }
      const account =
        sshTarget(remote) === undefined
          ? undefined
          : await sshAccount({ remote, sshKey, env, signal });
      const text = account === undefined ? "" : `\n${accountText(account)}`;
      if (failure === undefined) {
        return { status: "ok", detail: `the remote answers: ${remote}${text}` };
      }
      return {
        status: "error",
        detail: `${remoteNotAnswering(remote, failure).message}${text}`,
        remediation: connectionRemediation(account),
      };
    },
  );
}

// Reports lock files in the clone that nobody has written for a minute. It deletes nothing.
// procView gives the view of /proc. The check calls it only when it finds a stale lock.
export function staleLockCheck(
  repo: GitDoctorRepo,
  procView: () => ProcView | undefined,
  timeoutMs = 10000,
): Check {
  return makeCheck(
    {
      name: `git lock files: ${repo.key}`,
      required: false,
      timeoutMs,
      sshKey: repo.config.sshKey,
    },
    async (_env, { deadline }) => {
      if (!existsSync(repo.clone)) {
        return NO_CLONE;
      }
      const found = findStaleLocks(repo.clone, Date.now(), deadline);
      if (found.length === 0) {
        return { status: "ok", detail: "no stale lock files" };
      }
      const root = realpathSync(repo.clone);
      const view = procView();
      const left: string[] = [];
      const skipped: string[] = [];
      for (const lock of found) {
        const rel = relative(root, lock.path);
        const cwd =
          view?.readable === true
            ? view.gitCwds.find((folder) => isInside(lock.path, folder))
            : undefined;
        if (view?.readable === true && view.openFiles.has(lock.path)) {
          skipped.push(`skipped ${rel}: a process has it open`);
        } else if (cwd !== undefined) {
          skipped.push(`skipped ${rel}: a git process runs in ${cwd}`);
        } else {
          left.push(`${rel} (${Math.floor(lock.ageMs / 1000)} s old)`);
        }
      }
      const notes: string[] = [];
      if (view === undefined) {
        notes.push(
          "tasker reads open files only on Linux, so it cannot tell whether a process uses these files.",
        );
      } else if (!view.readable) {
        notes.push(
          `tasker cannot read /proc (${view.reason}), so it cannot tell whether a process uses these files.`,
        );
      }
      if (left.length === 0) {
        return { status: "ok", detail: skipped.join("\n") };
      }
      return {
        status: "warn",
        detail: [...left, ...skipped, ...notes].join("\n"),
        remediation:
          "Doctor deletes nothing. Make sure that no tasker or git process uses the clone. Then delete each file by hand.",
      };
    },
  );
}

// All git checks: the version check, then the identity, connection and lock-file checks of each
// repo. The lock-file checks share one read of procRoot, made at the first stale lock.
// The caller passes procRoot "/proc" and platform process.platform.
export function gitDoctorChecks(options: {
  repos: readonly GitDoctorRepo[];
  procRoot: string;
  platform: NodeJS.Platform;
}): Check[] {
  const procView = onceProcView(options.procRoot, options.platform);
  return [
    gitVersionCheck(),
    ...options.repos.flatMap((repo) => [
      identityCheck(repo),
      connectionCheck(repo),
      staleLockCheck(repo, procView),
    ]),
  ];
}
