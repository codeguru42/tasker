import { GitError, runGit } from "./run.js";
import { runRemoteGit } from "./ssh.js";

const REMOTE_PREFIXES = ["refs/remotes/origin/", "origin/"];
const LOCAL_PREFIX = "refs/heads/";

// Parses the base branch that a user types. The result is the stored form:
// the name of an origin branch, or refs/heads/<x> for a local branch of the clone.
export function parseBaseInput(input: string): string {
  const prefix = REMOTE_PREFIXES.find((candidate) => input.startsWith(candidate));
  const name = prefix === undefined ? input : input.slice(prefix.length);
  if (name === "" || name === LOCAL_PREFIX) {
    throw new Error("the base branch is empty");
  }
  if (prefix !== undefined && name.startsWith(LOCAL_PREFIX)) {
    throw new Error(`the base branch is not a branch name: ${input}`);
  }
  return name;
}

// Gives the full ref of a stored base. The short name origin/<x> can name a stale
// local branch in the bare clone, so a remote base uses refs/remotes/origin/<x>.
export function baseRevision(base: string): string {
  return base.startsWith(LOCAL_PREFIX) ? base : `refs/remotes/origin/${base}`;
}

// The store functions that the resolve needs. TaskStore has them.
interface BaseBranchMemory {
  getDefaultBaseBranch(repoKey: string): string | undefined;
  setDefaultBaseBranch(repoKey: string, branch: string): void;
  forgetDefaultBaseBranch(repoKey: string, branch: string): void;
}

interface ResolveBaseOptions {
  repoKey: string;
  // The bare clone that provisionClone() made.
  clone: string;
  // repo.vcs.config.sshKey
  sshKey: string | undefined;
  env: NodeJS.ProcessEnv;
  memory: BaseBranchMemory;
  // Untrusted text from the issue tracker, used as it is.
  hint?: string;
  // The raw --base text of this run.
  explicit?: string;
  // repo.defaultBaseBranch, used as it is.
  defaultBaseBranch?: string;
  ask: () => Promise<string>;
}

interface ResolvedBase {
  // The stored form: an origin branch name, or refs/heads/<x>.
  base: string;
  // baseRevision(base)
  revision: string;
  source: "hint" | "explicit" | "learned" | "config" | "ask";
  notes: string[];
}

// True when the ref of base exists in the clone. Exit 1 of show-ref means that the ref is missing.
async function exists(clone: string, env: NodeJS.ProcessEnv, base: string): Promise<boolean> {
  try {
    await runGit(["show-ref", "--verify", "--quiet", "--", baseRevision(base)], {
      gitDir: clone,
      env,
    });
    return true;
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}

// Fetches origin, then picks the base branch of a task.
export async function resolveBaseBranch(options: ResolveBaseOptions): Promise<ResolvedBase> {
  const { clone, env } = options;
  const explicit = options.explicit === undefined ? undefined : parseBaseInput(options.explicit);
  await runRemoteGit(["fetch", "origin", "--prune"], { gitDir: clone, env }, options.sshKey);
  if (explicit === undefined) {
    throw new Error("the base branch has no source yet");
  }
  if (!(await exists(clone, env, explicit))) {
    throw new Error(`the base branch does not exist: ${explicit} (from --base)`);
  }
  return { base: explicit, revision: baseRevision(explicit), source: "explicit", notes: [] };
}
