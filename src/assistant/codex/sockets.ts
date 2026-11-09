import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { isSet } from "../../config/path.js";
import { hasErrnoCode } from "../../errno.js";
import { DOCKER_SOCKET_PATH, herdrPath, runtimePath } from "../shared-sandbox-paths.js";

// A Codex run of any role must not read the herdr folder, the SSH_AUTH_SOCK file, the XDG_RUNTIME_DIR folder,
// or /var/run/docker.sock. The network is on, so a command can connect to sockets whose paths have no deny key.
// env is the env before the child filter. Herdr holds its sockets and the link herdr.sock.agent. The SSH socket,
// runtime folder, and Docker socket use their real paths, because a table key must not be a link. A missing path
// for the runtime folder or Docker socket is left out.
export function codexSocketDenyPaths(env: NodeJS.ProcessEnv, dockerSocketPath: string = DOCKER_SOCKET_PATH): string[] {
  const paths: string[] = [];
  const herdr = herdrPath(env);
  if (herdr !== undefined) paths.push(herdr);
  if (isSet(env.SSH_AUTH_SOCK)) {
    try {
      paths.push(realpathSync(env.SSH_AUTH_SOCK));
    } catch {
      // The socket does not exist, so there is nothing to deny.
    }
  }
  const runtime = runtimePath(env);
  if (runtime !== undefined) {
    const realRuntime = realpathMissingPath(runtime);
    if (realRuntime !== undefined) paths.push(realRuntime);
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
