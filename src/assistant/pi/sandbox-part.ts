import { realPathWithMissingParents } from "../../real-path.js";
import { isSet } from "../../config/path.js";
import { herdrPath, runtimePath, DOCKER_SOCKET_PATH } from "../shared-sandbox-paths.js";
import type { RunInput } from "../provider.js";
import type { PiSandboxLimits } from "./guard-limits.js";
import { parseDbusAddress } from "./dbus-address.js";

export function sandboxPart(input: RunInput, bwrap: string, tempFolder: string): PiSandboxLimits {
  const env = input.env;
  const hidePaths = [...(input.sandbox?.denyRead ?? [])];
  const herdr = herdrPath(env);
  if (herdr !== undefined) hidePaths.push(herdr);
  if (isSet(env.SSH_AUTH_SOCK)) hidePaths.push(env.SSH_AUTH_SOCK);
  const dbus = parseDbusAddress(env.DBUS_SESSION_BUS_ADDRESS);
  if ("paths" in dbus) hidePaths.push(...dbus.paths);
  const runtime = runtimePath(env);
  if (runtime !== undefined) hidePaths.push(runtime);
  hidePaths.push(DOCKER_SOCKET_PATH);

  return {
    bwrap,
    worktree: realPathWithMissingParents(input.cwd),
    writePaths: (input.sandbox?.allowWrite ?? []).map(realPathWithMissingParents),
    tempFolder: realPathWithMissingParents(tempFolder),
    hidePaths,
  };
}
