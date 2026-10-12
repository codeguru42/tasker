import { pushWithToken } from "./push-guard.js";
import { GitError } from "./run.js";
import { type RemoteTip, remoteTip } from "./remote-tip.js";
import { assertTaskBranch, assertTaskBranchShape, taskBranchRevision } from "./worktree.js";

interface RemoteOptions {
  // The bare clone that provisionClone() made.
  clone: string;
  // The remote of the repo, the same text that provisionClone() got.
  remote: string;
  // repoPaths().publishTokens
  publishTokens: string;
  // repo.vcs.config.sshKey
  sshKey: string | undefined;
  env: NodeJS.ProcessEnv;
}

export interface PublishResult {
  state: "published" | "already-published";
  branch: string;
  revision: string;
  lease: boolean;
}

// Throws unless value is a full revision of the clone: 40 lower-case hex characters.
function assertRevision(name: string, value: string): void {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${name} is not a full revision: ${JSON.stringify(value)}`);
  }
}

// ": <detail>" for a person to read, or "" when there is no detail. No code reads it.
function detail(error: Error): string {
  const text = (error instanceof GitError ? error.stderr : error.message).trim();
  return text === "" ? "" : `: ${text}`;
}

// The error to throw for a failure: a new Error with the summary and the detail, and no cause.
// A value that is not an Error passes through.
function failed(summary: string, error: unknown): unknown {
  return error instanceof Error ? new Error(`${summary}${detail(error)}`) : error;
}

// The one copy of the moved error.
function movedError(branch: string, published: string | undefined, tip: RemoteTip): Error {
  const before =
    published === undefined ? "tasker never published it" : `tasker published ${published}`;
  const now = tip.state === "absent" ? "origin does not have it" : `origin has ${tip.revision}`;
  return new Error(`the task branch moved on origin: ${branch}: ${before}, ${now}`);
}

// The decision on a tip. The expected tip is published, or no branch when published is not set.
// "expected": the tip is the expected tip. "absent": origin has no branch, and published is set.
// A tip at any other revision throws the moved error.
function compareTip(
  branch: string,
  published: string | undefined,
  tip: RemoteTip,
): "expected" | "absent" {
  if (tip.state === "absent") return published === undefined ? "expected" : "absent";
  if (tip.revision === published) return "expected";
  throw movedError(branch, published, tip);
}

// Publishes the task branch to origin. published is the last revision that tasker published.
export async function publishTaskBranch(
  options: RemoteOptions & { branch: string; published: string | undefined },
): Promise<PublishResult> {
  const { clone, remote, publishTokens, sshKey, env, branch, published } = options;
  assertTaskBranch(branch);
  assertTaskBranchShape(branch);
  if (published !== undefined) assertRevision("the published revision", published);
  const summary = `cannot publish the task branch: ${branch}`;
  const revision = await taskBranchRevision({ clone, env, branch });
  let tip: RemoteTip;
  try {
    tip = await remoteTip({ remote, branch, sshKey, env });
  } catch (error) {
    throw failed(summary, error);
  }
  if (tip.state === "present" && tip.revision === revision) {
    return { state: "already-published", branch, revision, lease: false };
  }
  if (compareTip(branch, published, tip) === "absent") throw movedError(branch, published, tip);
  try {
    await pushWithToken(
      [
        `--force-with-lease=refs/heads/${branch}:${published ?? ""}`,
        "origin",
        `refs/heads/${branch}:refs/heads/${branch}`,
      ],
      { location: { gitDir: clone }, publishTokens, sshKey, env },
    );
  } catch (error) {
    throw failed(summary, error);
  }
  return { state: "published", branch, revision, lease: true };
}

function landError(revision: string, base: string, reason: string): Error {
  return new Error(`cannot land ${revision} on the base branch: ${base}: ${reason}`);
}

// Lands revision on the base branch of origin by fast-forward.
export async function landOnBase(
  options: RemoteOptions & { base: string; revision: string },
): Promise<void> {
  const { clone, remote, publishTokens, sshKey, env, base, revision } = options;
  const summary = `cannot land ${revision} on the base branch: ${base}`;
  let tip: RemoteTip;
  try {
    tip = await remoteTip({ remote, branch: base, sshKey, env });
  } catch (error) {
    throw failed(summary, error);
  }
  if (tip.state === "absent") {
    throw landError(revision, base, "the base branch does not exist on origin");
  }
  try {
    await pushWithToken(["origin", `${revision}:refs/heads/${base}`], {
      location: { gitDir: clone },
      publishTokens,
      sshKey,
      env,
    });
  } catch (error) {
    throw failed(summary, error);
  }
}
