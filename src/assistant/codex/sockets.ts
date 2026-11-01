import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { isSet } from "../../config/path.js";

// The paths that a codex run of any role must not read. They hold the sockets of herdr and of the ssh agent.
// A socket works when the network is on, so the filesystem table denies the paths. env is the env before the
// child filter. The herdr folder holds the sockets and the link herdr.sock.agent. The ssh agent socket is
// the real path of SSH_AUTH_SOCK, because a key of the table must not be a link. A path that does not
// resolve is left out.
export function codexSocketDenyPaths(env: NodeJS.ProcessEnv): string[] {
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
  return paths;
}
