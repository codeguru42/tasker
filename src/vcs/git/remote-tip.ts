import { LOCAL_PREFIX } from "../local-branch.js";
import type { RemoteTip } from "../provider.js";
import { GitError } from "./run.js";
import { remoteCwd, remoteNotAnswering, runRemoteGit } from "./ssh.js";

// The tip of one branch on the remote. The ls-remote pattern matches the tail of a ref and is a
// glob, so only the line whose ref is exactly refs/heads/<branch> counts. A failed read throws.
export async function remoteTip(options: {
  remote: string;
  branch: string;
  sshKey: string | undefined;
  env: NodeJS.ProcessEnv;
}): Promise<RemoteTip> {
  const { remote, branch, sshKey, env } = options;
  if (branch === "") {
    throw new Error("the branch name is empty");
  }
  const ref = `${LOCAL_PREFIX}${branch}`;
  let output: string;
  try {
    output = await runRemoteGit(["ls-remote", "--", remote, ref], { cwd: remoteCwd(), env }, sshKey);
  } catch (error) {
    if (!(error instanceof GitError)) {
      throw error;
    }
    throw remoteNotAnswering(remote, error);
  }
  for (const line of output.split("\n")) {
    const [revision, name] = line.split("\t");
    if (name === ref && revision !== undefined) {
      return { state: "present", revision };
    }
  }
  return { state: "absent" };
}
