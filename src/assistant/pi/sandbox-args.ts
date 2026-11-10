import { lstatSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { errnoCode } from "../../errno.js";
import { isInside } from "../../real-path.js";
import type { PiSandboxLimits } from "./guard-limits.js";

export interface SandboxArgsInput {
  sandbox: PiSandboxLimits;
  cwd: string;
  command: string;
}

export type SandboxArgsResult = { args: string[] } | { reason: string };

interface HideMount {
  args: string[];
  path: string;
}

export function sandboxArgs(input: SandboxArgsInput): SandboxArgsResult {
  try {
    const worktree = realPath(input.sandbox.worktree);
    const writePaths = input.sandbox.writePaths.map(realPath);
    const tempFolder = realPath(input.sandbox.tempFolder);
    const cwd = realPath(input.cwd);
    const gitPath = realPath(resolve(worktree, ".git"));
    const requiredWrites = [worktree, cwd, ...writePaths, tempFolder];
    const hidePaths = [...input.sandbox.hidePaths];
    const hides: HideMount[] = [];
    const seenHides = new Set<string>();
    for (const hidePath of hidePaths) {
      const hide = hideMount(hidePath);
      if (hide === undefined) continue;
      if (seenHides.has(hide.path)) continue;
      if (requiredWrites.some((required) => isInside(required, hide.path))) {
        return { reason: "hide path overlaps a writable path" };
      }
      seenHides.add(hide.path);
      hides.push(hide);
    }

    const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--bind", worktree, worktree];
    for (const path of writePaths) args.push("--bind", path, path);
    args.push("--bind", tempFolder, tempFolder, "--ro-bind", gitPath, gitPath);
    for (const hide of hides) args.push(...hide.args);
    args.push(
      "--unshare-pid",
      "--new-session",
      "--die-with-parent",
      "--setenv",
      "TMPDIR",
      tempFolder,
      "--chdir",
      cwd,
      "--",
      shellPath(),
      "-c",
      input.command,
    );
    return { args };
  } catch (error) {
    return { reason: `sandbox path error: ${errnoCode(error) ?? "unknown"}` };
  }
}

function realPath(path: string): string {
  if (!isAbsolute(path)) throw Object.assign(new Error("path is not absolute"), { code: "EINVAL" });
  return realpathSync.native(path);
}

function hideMount(path: string): HideMount | undefined {
  try {
    lstatSync(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT" || errnoCode(error) === "ENOTDIR") return undefined;
    throw error;
  }

  let real: string;
  try {
    real = realpathSync.native(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT" || errnoCode(error) === "ENOTDIR") return undefined;
    throw error;
  }
  const targetStat = statSync(real);
  return targetStat.isDirectory()
    ? { args: ["--tmpfs", real], path: real }
    : { args: ["--ro-bind", "/dev/null", real], path: real };
}

function shellPath(): string {
  return lstatSync("/bin/bash", { throwIfNoEntry: false }) === undefined ? "bash" : "/bin/bash";
}
