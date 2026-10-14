import { chmodSync, renameSync, writeFileSync } from "node:fs";

// Writes text to <path>.tmp, then renames the temp file over path. With a mode, it also sets the mode
// of the temp file, because the umask can remove bits from the mode of writeFileSync.
export function writeThroughTemp(path: string, text: string, mode?: number): void {
  const temp = `${path}.tmp`;
  if (mode === undefined) {
    writeFileSync(temp, text);
  } else {
    writeFileSync(temp, text, { mode });
    chmodSync(temp, mode);
  }
  renameSync(temp, path);
}
