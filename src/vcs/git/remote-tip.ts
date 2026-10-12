import { remoteCwd, runRemoteGit } from "./ssh.js";

export type RemoteTip = { state: "present"; revision: string } | { state: "absent" };

// The tip of one branch on the remote. The ls-remote pattern matches the tail of a ref and is a glob,
// so only the line whose ref is exactly refs/heads/<branch> counts.
export async function remoteTip(options: {
  remote: string;
  branch: string;
  sshKey: string | undefined;
  env: NodeJS.ProcessEnv;
}): Promise<RemoteTip> {
  const { remote, branch, sshKey, env } = options;
  const ref = `refs/heads/${branch}`;
  const output = await runRemoteGit(
    ["ls-remote", "--", remote, ref],
    { cwd: remoteCwd(), env },
    sshKey,
  );
  for (const line of output.split("\n")) {
    const [revision, name] = line.split("\t");
    if (name === ref && revision !== undefined) {
      return { state: "present", revision };
    }
  }
  return { state: "absent" };
}
