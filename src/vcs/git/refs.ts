import { GitError, runGit } from "./run.js";

interface RefOptions {
  clone: string;
  env: NodeJS.ProcessEnv;
  ref: string;
}

// True when value is a full revision of the clone: 40 lower-case hex characters.
export function isFullRevision(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

// True when the exact ref exists in the clone. Exit 1 of show-ref means that the ref is missing.
export async function refExists({ clone, env, ref }: RefOptions): Promise<boolean> {
  try {
    await runGit(["show-ref", "--verify", "--quiet", "--", ref], { gitDir: clone, env });
    return true;
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return false;
    throw error;
  }
}

// The SHA of the exact ref, or undefined when the ref is missing.
export async function refRevision(options: RefOptions): Promise<string | undefined> {
  if (!(await refExists(options))) return undefined;
  const { clone, env, ref } = options;
  const output = await runGit(["show-ref", "--verify", "--hash", "--", ref], {
    gitDir: clone,
    env,
  });
  return output.trim();
}

// Throws unless value is a full revision or starts with "refs/".
export function assertRevisionInput(value: string): void {
  if (!isFullRevision(value) && !value.startsWith("refs/")) {
    throw new Error(`not a full revision or ref: ${JSON.stringify(value)}`);
  }
}

// A full revision stays as it is. A ref gives its SHA. A missing ref throws.
export async function resolveRevision(o: {
  clone: string;
  env: NodeJS.ProcessEnv;
  value: string;
}): Promise<string> {
  const { clone, env, value } = o;
  assertRevisionInput(value);
  if (isFullRevision(value)) return value;
  const sha = await refRevision({ clone, env, ref: value });
  if (sha === undefined) throw new Error(`cannot resolve the revision: ${value}`);
  return sha;
}
