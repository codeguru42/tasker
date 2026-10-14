import { randomUUID } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { errnoCode } from "./errno.js";

// Replaces the file at path with text, or writes a new file there. It writes a temp file in the folder of the
// target, then renames the temp file over the target. As a result, a reader sees the old file or the new file,
// never a part of one. A symlink at path stays a symlink. The mode is options.mode, else the mode of the
// existing file. A new file with no mode gets the mode that the umask gives.
export function replaceFile(path: string, text: string, options: { mode?: number } = {}): void {
  const real = realPathOrNothing(path);
  const target = real ?? path;
  const mode = options.mode ?? (real === undefined ? undefined : statSync(real).mode & 0o7777);
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  // A failed create leaves no file of ours, so nothing is removed.
  const fd = openSync(tmp, "wx", mode ?? 0o666);
  try {
    try {
      writeFileSync(fd, text);
      // The umask can remove bits from the mode of the create.
      if (mode !== undefined) fchmodSync(fd, mode);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, target);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

// The real path of path, or undefined when nothing is at path. Any other error passes through.
function realPathOrNothing(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    throw error;
  }
}
