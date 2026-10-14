import { LOCAL_PREFIX } from "../local-branch.js";
import { GitError } from "./run.js";
import { remoteCwd, remoteNotAnswering, runRemoteGit } from "./ssh.js";

export type RemoteTip = { state: "present"; revision: string } | { state: "absent" };

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
    output = await runRemoteGit(
      ["ls-remote", "--", remote, ref],
      { cwd: remoteCwd(), env },
      sshKey,
    );
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

// A message when the tip of the branch on the remote moved from before to after.
// Otherwise undefined.
export function tipMoved(before: RemoteTip, after: RemoteTip): string | undefined {
  const name = (tip: RemoteTip): string => (tip.state === "present" ? tip.revision : "absent");
  if (name(before) === name(after)) {
    return undefined;
  }
  return `the tip of the branch on the remote moved from ${name(before)} to ${name(after)}`;
}
