import { isAbsolute, resolve } from "node:path";
import { expandPiHomeKey } from "../config-folders.js";
import { isInside, realPathWithMissingParents } from "../../real-path.js";
import {
  isLocalPiSource,
  listPiExtensions,
  maskExtensionKey,
  realPathFailureReason,
  type PiExtension,
} from "./extensions.js";
import type { PiSandboxLimits } from "./guard-limits.js";

// A key that starts with a tilde resolves from HOME. Without HOME, it has no path and the caller gets undefined.
function extensionPath(agentDir: string, extension: PiExtension, home: string | undefined): string | undefined {
  const fromAgent = (key: string) => {
    const expanded = expandPiHomeKey(key, home);
    if (expanded === undefined) return undefined;
    return isAbsolute(expanded) ? expanded : resolve(agentDir, expanded);
  };
  if (extension.source === "folder") return extension.key;
  if (extension.source === "settings-extensions") return fromAgent(extension.key);
  return isLocalPiSource(extension.key) ? fromAgent(extension.key) : agentDir;
}

// True when one path is equal to, under or above the other.
function overlaps(extension: string, folder: string): boolean {
  return isInside(extension, folder) || isInside(folder, extension);
}

// Refuses a trusted extension that the worktree, an allowed write path or the temp folder can change.
export function trustedExtensionRefusal(
  agentDir: string,
  trusted: readonly string[],
  sandbox: PiSandboxLimits,
  home?: string,
): string | undefined {
  const listed = listPiExtensions(agentDir, sandbox.worktree);
  if ("reason" in listed) return listed.reason;
  const trustedKeys = new Set(trusted);
  const details: string[] = [];
  for (const extension of listed.extensions) {
    if (extension.source === "builtin" || !trustedKeys.has(extension.key)) continue;
    const masked = maskExtensionKey(extension.key);
    const path = extensionPath(agentDir, extension, home);
    if (path === undefined) return realPathFailureReason(masked, { code: "EINVAL" });
    let real: string;
    try {
      real = realPathWithMissingParents(path);
    } catch (error) {
      return realPathFailureReason(masked, error);
    }
    const kinds: string[] = [];
    if (overlaps(real, sandbox.worktree)) kinds.push("in the worktree");
    if (sandbox.writePaths.some((path) => overlaps(real, path))) kinds.push("in a path of sandbox.allowWrite");
    if (overlaps(real, sandbox.tempFolder)) kinds.push("in the temp folder of the start");
    if (kinds.length > 0) details.push(`${masked} (${kinds.join(", ")})`);
  }
  if (details.length === 0) return undefined;
  return `pi can load trusted extensions that the run can change: ${details.join(", ")}. Move each extension out of the write paths of the run.`;
}
