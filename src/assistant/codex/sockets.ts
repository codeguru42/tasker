import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { isSet } from "../../config/path.js";
import { hasErrnoCode } from "../../errno.js";

// A Codex run of any role must not read the herdr folder, the SSH_AUTH_SOCK file, the XDG_RUNTIME_DIR folder,
// or /var/run/docker.sock. The network is on, so a command can connect to sockets whose paths have no deny key.
// env is the env before the child filter. Herdr holds its sockets and the link herdr.sock.agent. The SSH socket,
// runtime folder, and Docker socket use their real paths, because a table key must not be a link. A missing path
// for the runtime folder or Docker socket is left out.
export const DOCKER_SOCKET_PATH = "/var/run/docker.sock";

export function codexSocketDenyPaths(env: NodeJS.ProcessEnv, dockerSocketPath: string = DOCKER_SOCKET_PATH): string[] {
  const paths: string[] = [];
  if (isSet(env.XDG_CONFIG_HOME)) paths.push(resolve(join(env.XDG_CONFIG_HOME, "herdr")));
  else if (isSet(env.HOME)) paths.push(resolve(join(env.HOME, ".config", "herdr")));
  if (isSet(env.SSH_AUTH_SOCK)) {
    try {
      paths.push(realpathSync(env.SSH_AUTH_SOCK));
    } catch {
      // The socket does not exist, so there is nothing to deny.
    }
  }
  if (isSet(env.XDG_RUNTIME_DIR)) {
    const runtimePath = realpathMissingPath(env.XDG_RUNTIME_DIR);
    if (runtimePath !== undefined) paths.push(runtimePath);
  }
  const dockerPath = realpathMissingPath(dockerSocketPath);
  if (dockerPath !== undefined) paths.push(dockerPath);
  return paths;
}

function realpathMissingPath(path: string): string | undefined {
  try {
    return realpathSync(resolve(path));
  } catch (error) {
    if (hasErrnoCode(error, ["ENOENT", "ENOTDIR"])) return undefined;
    throw error;
  }
}
