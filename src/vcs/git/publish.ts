import { pushWithToken } from "./push-guard.js";
import { remoteTip } from "./remote-tip.js";
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

// Publishes the task branch to origin. published is the last revision that tasker published.
export async function publishTaskBranch(
  options: RemoteOptions & { branch: string; published: string | undefined },
): Promise<PublishResult> {
  const { clone, remote, publishTokens, sshKey, env, branch } = options;
  const revision = await taskBranchRevision({ clone, env, branch });
  const tip = await remoteTip({ remote, branch, sshKey, env });
  if (tip.state === "present" && tip.revision === revision) {
    return { state: "already-published", branch, revision, lease: false };
  }
  await pushWithToken(
    [
      `--force-with-lease=refs/heads/${branch}:`,
      "origin",
      `refs/heads/${branch}:refs/heads/${branch}`,
    ],
    { location: { gitDir: clone }, publishTokens, sshKey, env },
  );
  return { state: "published", branch, revision, lease: true };
}
