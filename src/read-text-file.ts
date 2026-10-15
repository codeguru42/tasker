import { readFileSync } from "node:fs";
import { errnoCode } from "./errno.js";
import { errorMessage } from "./error-message.js";

// The text of a read error: its errno code, for example EISDIR, else its message.
export function readErrorText(error: unknown): string {
  return errnoCode(error) ?? errorMessage(error);
}

export type TextFile = { text: string } | { text: undefined; missing: boolean; error: string; cause: unknown };

// The text of the file at path, read as utf8, or the read error. missing is true for ENOENT. error is the text of
// readErrorText. It never throws.
export function readTextFile(path: string): TextFile {
  try {
    return { text: readFileSync(path, "utf8") };
  } catch (cause) {
    return { text: undefined, missing: errnoCode(cause) === "ENOENT", error: readErrorText(cause), cause };
  }
}
