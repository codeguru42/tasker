import { realpathSync } from "node:fs";
import { join } from "node:path";
import { canonicalPath, isInside } from "../../real-path.js";
import type { SandboxLimits } from "../provider.js";

// The settings of claude for a sandboxed run. claude must refuse to start when it cannot build the sandbox,
// and a command must never ask to leave it. The network stays open. With a socket folder, it is the only
// Unix socket that a command can use. allowAllUnixSockets is never set: it opens the sockets of the
// ssh agent and the keyring.
export function sandboxSettings(limits: SandboxLimits, socketFolder: string | undefined): Record<string, unknown> {
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: { allowWrite: [...limits.allowWrite], denyRead: [...limits.denyRead] },
      network: {
        allowedDomains: ["*"],
        ...(socketFolder === undefined ? {} : { allowUnixSockets: [socketFolder] }),
      },
    },
  };
}

// The real path of a folder. A missing folder gives the real parent plus the last part.
// An error gives the code only, because the message of an fs error holds the path.
function realPath(path: string): string {
  let code: string | undefined;
  try {
    return realpathSync(path);
  } catch (error) {
    code = (error as NodeJS.ErrnoException).code;
  }
  if (code === "ENOENT") {
    try {
      return canonicalPath(path);
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code;
    }
  }
  throw new Error(`cannot resolve the sandbox temp folder: ${code ?? "unknown"}`);
}

// The one Unix socket folder that claude needs: claude-<uid> under the temp root, as a real path.
// It gives nothing with no uid, and nothing when the folder is a shared temp folder or holds one,
// because then every user of the machine could reach the sockets in it.
export function sandboxSocketFolder(o: {
  uid: number | undefined;
  tmpRoot: string;
  sharedTemps: readonly string[];
}): string | undefined {
  if (o.uid === undefined) return undefined;
  const folder = realPath(join(o.tmpRoot, `claude-${o.uid}`));
  for (const shared of o.sharedTemps) {
    if (isInside(realPath(shared), folder)) return undefined;
  }
  return folder;
}
