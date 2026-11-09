import { join, resolve } from "node:path";
import { isSet } from "../config/path.js";

// The temp root that a child uses.
export function childTempRoot(env: NodeJS.ProcessEnv): string {
  return isSet(env.TMPDIR) ? resolve(env.TMPDIR) : "/tmp";
}

// The herdr folder selected by the environment, with no link resolution.
export function herdrPath(env: NodeJS.ProcessEnv): string | undefined {
  if (isSet(env.XDG_CONFIG_HOME)) return resolve(join(env.XDG_CONFIG_HOME, "herdr"));
  if (isSet(env.HOME)) return resolve(join(env.HOME, ".config", "herdr"));
  return undefined;
}

// The runtime folder selected by the environment, with no link resolution.
export function runtimePath(env: NodeJS.ProcessEnv): string | undefined {
  return isSet(env.XDG_RUNTIME_DIR) ? resolve(env.XDG_RUNTIME_DIR) : undefined;
}

export const DOCKER_SOCKET_PATH = "/var/run/docker.sock";
