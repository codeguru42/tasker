import { realPathWithMissingParents } from "../../real-path.js";
import { isSet } from "../../config/path.js";
import { herdrPath, runtimePath, DOCKER_SOCKET_PATH } from "../shared-sandbox-paths.js";
import type { RunInput } from "../provider.js";
import type { PiSandboxLimits } from "./guard-limits.js";

export function sandboxPart(input: RunInput, bwrap: string, tempFolder: string): PiSandboxLimits {
  const env = input.env;
  const hidePaths = [...(input.sandbox?.denyRead ?? [])];
  const herdr = herdrPath(env);
  if (herdr !== undefined) hidePaths.push(herdr);
  if (isSet(env.SSH_AUTH_SOCK)) hidePaths.push(env.SSH_AUTH_SOCK);
  hidePaths.push(...dbusSocketPaths(env.DBUS_SESSION_BUS_ADDRESS));
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

function dbusSocketPaths(addresses: string | undefined): string[] {
  if (!isSet(addresses)) return [];
  const paths: string[] = [];
  for (const address of addresses.split(";")) {
    const separator = address.indexOf(":");
    if (separator < 0 || address.slice(0, separator) !== "unix") continue;
    const pathField = address
      .slice(separator + 1)
      .split(",")
      .find((field) => field.startsWith("path="));
    if (pathField !== undefined) paths.push(decodeURIComponent(pathField.slice("path=".length)));
  }
  return paths;
}
