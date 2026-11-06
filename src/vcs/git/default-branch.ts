import { remoteCwd, runRemoteGit } from "./ssh.js";
import { fetchOrigin } from "./changes.js";

export interface RemoteDefaultBranchOptions {
  remote: string;
  sshKey: string | undefined;
  env: NodeJS.ProcessEnv;
}

// The branch that HEAD of the remote points to. It runs with the root of the file system as cwd,
// so it needs no clone. It throws when the remote has no symbolic HEAD.
export async function remoteDefaultBranch(options: RemoteDefaultBranchOptions): Promise<string> {
  const { remote, sshKey, env } = options;
  const out = await runRemoteGit(["ls-remote", "--symref", "--", remote, "HEAD"], { cwd: remoteCwd(), env }, sshKey);
  for (const line of out.split("\n")) {
    const match = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line);
    if (match !== null) {
      return match[1];
    }
  }
  throw new Error(`the remote has no symbolic HEAD: ${remote}`);
}

// Fetches origin into the clone, then reads the branch that the remote symbolic HEAD names.
export async function fetchRemoteDefaultBranch(
  options: RemoteDefaultBranchOptions & { clone: string },
): Promise<string> {
  const { clone, remote, sshKey, env } = options;
  await fetchOrigin({ clone, env, sshKey });
  return remoteDefaultBranch({ remote, sshKey, env });
}
