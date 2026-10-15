import { detailSuffix } from "../../detail-suffix.js";
import { LOCAL_PREFIX } from "../local-branch.js";
import type { RemoteTaskRefDeletion, RemoteTip } from "../provider.js";
import { pushWithToken } from "./push-guard.js";
import { assertRevision } from "./refs.js";
import { GitError } from "./run.js";
import { remoteTip } from "./remote-tip.js";
import { assertTaskBranchNameAndShape, taskBranchRevision } from "./worktree.js";

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

// The error to throw for a failure: a new Error with the summary and the detail for a person to read, and no cause.
// A value that is not an Error passes through.
function failed(summary: string, error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  return new Error(`${summary}${detailSuffix((error instanceof GitError ? error.stderr : error.message).trim())}`);
}

// Runs one step. A failure of the step throws failed(summary, error).
async function orFailed<T>(summary: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    throw failed(summary, error);
  }
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
  assertTaskBranchNameAndShape(branch);
  if (published !== undefined) assertRevision("the published revision", published);
  const summary = `cannot publish the task branch: ${branch}`;
  const revision = await taskBranchRevision({ clone, env, branch });
  const tip = await orFailed(summary, () => remoteTip({ remote, branch, sshKey, env }));
  if (tip.state === "present" && tip.revision === revision) {
    return { state: "already-published", branch, revision, lease: false };
  }
  if (compareTip(branch, published, tip) === "absent") throw movedError(branch, published, tip);
  await orFailed(summary, () =>
    pushWithToken(
      [
        `--force-with-lease=${LOCAL_PREFIX}${branch}:${published ?? ""}`,
        "origin",
        `${LOCAL_PREFIX}${branch}:${LOCAL_PREFIX}${branch}`,
      ],
      { location: { gitDir: clone }, publishTokens, sshKey, env },
    ),
  );
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
  assertRevision("the revision", revision);
  if (base === "") throw new Error(`cannot land ${revision}: the base branch is empty`);
  if (base.startsWith(LOCAL_PREFIX)) {
    throw landError(revision, base, "the base is a local branch");
  }
  const summary = `cannot land ${revision} on the base branch: ${base}`;
  // The read refuses a base that origin does not have now. A base that someone deletes before the push is made again at revision.
  const tip = await orFailed(summary, () => remoteTip({ remote, branch: base, sshKey, env }));
  if (tip.state === "absent") {
    throw landError(revision, base, "the base branch does not exist on origin");
  }
  await orFailed(summary, () =>
    pushWithToken(["origin", `${revision}:${LOCAL_PREFIX}${base}`], {
      location: { gitDir: clone },
      publishTokens,
      sshKey,
      env,
    }),
  );
}

// Deletes the task branch on origin, when origin still has it at the published revision.
export async function deleteRemoteTaskBranch(
  options: RemoteOptions & { branch: string; published: string },
): Promise<RemoteTaskRefDeletion> {
  const { clone, remote, publishTokens, sshKey, env, branch, published } = options;
  assertTaskBranchNameAndShape(branch);
  assertRevision("the published revision", published);
  const summary = `cannot delete the task branch on origin: ${branch}`;
  const readTip = (): Promise<RemoteTip> => orFailed(summary, () => remoteTip({ remote, branch, sshKey, env }));
  if (compareTip(branch, published, await readTip()) === "absent") {
    return { state: "already-gone" };
  }
  try {
    await pushWithToken(
      [`--force-with-lease=${LOCAL_PREFIX}${branch}:${published}`, "origin", `:${LOCAL_PREFIX}${branch}`],
      { location: { gitDir: clone }, publishTokens, sshKey, env },
    );
  } catch (error) {
    // Someone can have moved or deleted the branch since the first read.
    // A failed second read must not hide the push error.
    const after = await readTip().catch(() => undefined);
    if (after !== undefined && compareTip(branch, published, after) === "absent") {
      return { state: "already-gone" };
    }
    throw failed(summary, error);
  }
  return { state: "deleted" };
}
