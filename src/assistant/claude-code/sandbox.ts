import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
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

// True when a folder of env.PATH holds an executable file with this name.
// A missing or unreadable entry counts as "not there". It never throws.
export function isOnPath(program: string, env: NodeJS.ProcessEnv): boolean {
  for (const folder of (env.PATH ?? "").split(delimiter)) {
    if (folder === "") continue;
    const path = join(folder, program);
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

// The programs that the sandbox of claude needs on Linux, with the package that holds each one.
export const LINUX_SANDBOX_PROGRAMS = [
  { program: "bwrap", pkg: "bubblewrap" },
  { program: "socat", pkg: "socat" },
] as const;

// The reason that this host cannot build the sandbox, or undefined. env is the env that claude gets.
export function sandboxHostRefusal(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | undefined {
  if (platform !== "linux" && platform !== "darwin") {
    return `the claude-code provider cannot enforce a sandbox on ${platform}`;
  }
  if (platform === "darwin") return undefined;
  for (const { program } of LINUX_SANDBOX_PROGRAMS) {
    if (!isOnPath(program, env)) return `the claude-code sandbox needs ${program}, and ${program} is not on PATH`;
  }
  return undefined;
}

// claude 2.1.299 reads the .git file of its cwd. When the shared git folder of the worktree has a name
// that ends in ".git", claude adds all of that folder to its sandbox write list. The version control
// layer gives the shared folder. This guard applies only the rule of claude. The reason holds no path.
export function sharedFolderRefusal(sharedFolder: string): string | undefined {
  return basename(sharedFolder).endsWith(".git")
    ? "the shared git folder of the worktree has a name that ends in .git, and claude then makes all of it writable"
    : undefined;
}
