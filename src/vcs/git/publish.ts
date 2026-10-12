import { pushWithToken } from "./push-guard.js";
import { type RemoteTip, remoteTip } from "./remote-tip.js";
import { taskBranchRevision } from "./worktree.js";

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
  const revision = await taskBranchRevision({ clone, env, branch });
  const tip = await remoteTip({ remote, branch, sshKey, env });
  if (tip.state === "present" && tip.revision === revision) {
    return { state: "already-published", branch, revision, lease: false };
  }
  if (compareTip(branch, published, tip) === "absent") throw movedError(branch, published, tip);
  await pushWithToken(
    [
      `--force-with-lease=refs/heads/${branch}:${published ?? ""}`,
      "origin",
      `refs/heads/${branch}:refs/heads/${branch}`,
    ],
    { location: { gitDir: clone }, publishTokens, sshKey, env },
  );
  return { state: "published", branch, revision, lease: true };
}
