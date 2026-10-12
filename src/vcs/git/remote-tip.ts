import { GitError } from "./run.js";
import { remoteCwd, runRemoteGit } from "./ssh.js";

export type RemoteTip = { state: "present"; revision: string } | { state: "absent" };

// The tip of one branch on the remote. The ls-remote pattern matches the tail of a ref and is a glob,
// so only the line whose ref is exactly refs/heads/<branch> counts. A failed read throws.
export async function remoteTip(options: {
  remote: string;
  branch: string;
  sshKey: string | undefined;
  env: NodeJS.ProcessEnv;
}): Promise<RemoteTip> {
  const { remote, branch, sshKey, env } = options;
  const ref = `refs/heads/${branch}`;
  let output: string;
  try {
    output = await runRemoteGit(["ls-remote", "--", remote, ref], { cwd: remoteCwd(), env }, sshKey);
  } catch (error) {
    if (!(error instanceof GitError)) {
      throw error;
    }
    const detail = error.stderr.trim();
    // The error text can hold git output, so the new error sets no cause.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`the remote does not answer: ${remote}${detail === "" ? "" : `: ${detail}`}`);
  }
  for (const line of output.split("\n")) {
    const [revision, name] = line.split("\t");
    if (name === ref && revision !== undefined) {
      return { state: "present", revision };
    }
  }
  return { state: "absent" };
}
