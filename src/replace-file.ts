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

// Replaces the file at path with text. It writes a temp file in the folder of the real file, then renames the temp
// file over the real file. As a result, a reader sees the old file or the new file, never a part of one.
// A symlink at path stays a symlink. The file keeps its mode.
export function replaceFile(path: string, text: string): void {
  const real = realpathSync(path);
  const mode = statSync(real).mode & 0o7777;
  const tmp = join(dirname(real), `.${basename(real)}.${process.pid}.${randomUUID()}.tmp`);
  // A failed create leaves no file of ours, so nothing is removed.
  const fd = openSync(tmp, "wx", mode);
  try {
    try {
      writeFileSync(fd, text);
      // The umask can remove bits from the mode of the create.
      fchmodSync(fd, mode);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, real);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
