import { randomUUID } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  lstatSync,
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
// never a part of one. By default it follows a symlink at path, so the link stays and its target gets the text.
// A broken symlink at path then throws the ENOENT error of realpathSync, and the link stays as it is.
// With followSymlink false, the target is path itself, and a symlink there becomes a regular file.
// The mode is options.mode, else the mode of the existing file. A new file with no mode gets the mode that the umask gives.
export function replaceFile(
  path: string,
  text: string,
  options: { mode?: number; followSymlink?: boolean } = {},
): void {
  const follow = options.followSymlink ?? true;
  const real = follow ? realPathOrNothing(path) : undefined;
  const target = real ?? path;
  const mode = options.mode ?? (follow ? modeOf(real) : regularFileMode(path));
  placeTempFile(target, text, mode, (tmp) => renameSync(tmp, target));
}

// Writes text to a new temp file in the folder of target, calls place with the temp path, and then removes
// the temp file. The temp file goes also after an error of the write or of place.
export function placeTempFile(
  target: string,
  text: string,
  mode: number | undefined,
  place: (tmp: string) => void,
): void {
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
    place(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// The real path of path, or undefined when nothing is at path. A broken symlink at path is not "nothing":
// its ENOENT passes through, so the link stays as it is. Any other error passes through.
function realPathOrNothing(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT" && lstatSync(path, { throwIfNoEntry: false }) === undefined) return undefined;
    throw error;
  }
}

// The mode of the file at real, or undefined when there is no file.
function modeOf(real: string | undefined): number | undefined {
  return real === undefined ? undefined : statSync(real).mode & 0o7777;
}

// The mode of the regular file at path, with no symlink followed. It gives undefined for a missing path,
// a symlink or another kind of entry.
function regularFileMode(path: string): number | undefined {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  return stat?.isFile() === true ? stat.mode & 0o7777 : undefined;
}
