import { LOCAL_PREFIX } from "../local-branch.js";
import type { BaseBranchMemory, ResolvedBase } from "../provider.js";
import { fetchOrigin } from "./changes.js";
import { refExists } from "./refs.js";

const REMOTE_PREFIXES = ["refs/remotes/origin/", "origin/"];

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

// Gives the full ref of a stored base. The short name origin/<x> can name a tag
// or a local branch first, so a remote base uses refs/remotes/origin/<x>.
export function baseRevision(base: string): string {
  return base.startsWith(LOCAL_PREFIX) ? base : `refs/remotes/origin/${base}`;
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

// True when the ref of base exists in the clone.
function exists(clone: string, env: NodeJS.ProcessEnv, base: string): Promise<boolean> {
  return refExists({ clone, env, ref: baseRevision(base) });
}

// Fetches origin, then picks the base branch of a task. The sources come in this order:
// the hint, --base, the learned default, defaultBaseBranch and the answer of ask.
export async function resolveBaseBranch(options: ResolveBaseOptions): Promise<ResolvedBase> {
  const { repoKey, clone, env, hint, memory } = options;
  const explicit = options.explicit === undefined ? undefined : parseBaseInput(options.explicit);
  if (hint === "") {
    throw new Error("the base branch of the issue is empty");
  }
  if (hint?.startsWith(LOCAL_PREFIX)) {
    throw new Error(`the base branch of the issue must name a remote branch: ${hint}`);
  }
  await fetchOrigin({ clone, env, sshKey: options.sshKey });

  const notes: string[] = [];
  const found = (base: string, source: ResolvedBase["source"]): ResolvedBase => ({
    base,
    revision: baseRevision(base),
    source,
    notes,
  });
  // Saves a value that exists in the clone as the learned default of the repo.
  const learn = (base: string, source: "config" | "ask"): ResolvedBase => {
    memory.setDefaultBaseBranch(repoKey, base);
    notes.push(`tasker saved ${base} as the default base branch of ${repoKey}.`);
    return found(base, source);
  };

  if (hint !== undefined) {
    if (!(await exists(clone, env, hint))) {
      throw new Error(`the base branch does not exist on origin: ${hint} (from the issue)`);
    }
    return found(hint, "hint");
  }

  if (explicit !== undefined) {
    if (!(await exists(clone, env, explicit))) {
      throw new Error(`the base branch does not exist: ${explicit} (from --base)`);
    }
    return found(explicit, "explicit");
  }

  const learned = memory.getDefaultBaseBranch(repoKey);
  if (learned !== undefined && (await exists(clone, env, learned))) {
    return found(learned, "learned");
  }
  if (learned !== undefined) {
    memory.forgetDefaultBaseBranch(repoKey, learned);
    notes.push(`the learned base branch ${learned} no longer exists on origin. tasker forgot it.`);
  }

  const configured = options.defaultBaseBranch;
  if (learned === undefined && configured !== undefined) {
    if (!(await exists(clone, env, configured))) {
      throw new Error(`the base branch does not exist on origin: ${configured} (from defaultBaseBranch)`);
    }
    return learn(configured, "config");
  }

  const answer = await options.ask();
  const asked = parseBaseInput(answer);
  if (asked.startsWith(LOCAL_PREFIX)) {
    throw new Error(`the base branch must name a remote branch: ${answer}`);
  }
  if (!(await exists(clone, env, asked))) {
    throw new Error(`the base branch does not exist on origin: ${asked} (from the answer)`);
  }
  return learn(asked, "ask");
}
