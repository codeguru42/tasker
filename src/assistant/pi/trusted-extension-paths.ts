import { isAbsolute, resolve } from "node:path";
import { isInside, realPathWithMissingParents } from "../../real-path.js";
import {
  isLocalPiSource,
  listPiExtensions,
  maskExtensionKey,
  realPathFailureReason,
  type PiExtension,
} from "./extensions.js";
import type { PiSandboxLimits } from "./guard-limits.js";

function extensionPath(agentDir: string, extension: PiExtension): string {
  const fromAgent = (key: string) => (isAbsolute(key) ? key : resolve(agentDir, key));
  if (extension.source === "folder") return extension.key;
  if (extension.source === "settings-extensions") return fromAgent(extension.key);
  return isLocalPiSource(extension.key) ? fromAgent(extension.key) : agentDir;
}

// Refuses a trusted extension that the worktree, an allowed write path or the temp folder can change.
export function trustedExtensionRefusal(
  agentDir: string,
  trusted: readonly string[],
  sandbox: PiSandboxLimits,
): string | undefined {
  const listed = listPiExtensions(agentDir, sandbox.worktree);
  if ("reason" in listed) return listed.reason;
  const trustedKeys = new Set(trusted);
  const details: string[] = [];
  for (const extension of listed.extensions) {
    if (extension.source === "builtin" || !trustedKeys.has(extension.key)) continue;
    const masked = maskExtensionKey(extension.key);
    let real: string;
    try {
      real = realPathWithMissingParents(extensionPath(agentDir, extension));
    } catch (error) {
      return realPathFailureReason(masked, error);
    }
    const kinds: string[] = [];
    if (isInside(real, sandbox.worktree)) kinds.push("in the worktree");
    if (sandbox.writePaths.some((path) => isInside(real, path))) kinds.push("in a path of sandbox.allowWrite");
    if (isInside(real, sandbox.tempFolder)) kinds.push("in the temp folder of the start");
    if (kinds.length > 0) details.push(`${masked} (${kinds.join(", ")})`);
  }
  if (details.length === 0) return undefined;
  return `pi can load trusted extensions that the run can change: ${details.join(", ")}. Move each extension out of the write paths of the run.`;
}
