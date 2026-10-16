import { createHash } from "node:crypto";
import { linkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hasErrnoCode } from "../errno.js";
import { placeTempFile } from "../replace-file.js";
import { dataRootLayout } from "../store/layout.js";

// docs/dev/assistants.md gives the reasons for the version and the archive.
export function promptVersion(name: string, template: string): string {
  if (name.includes("@")) throw new Error(`prompt name must not hold "@": ${name}`);
  return `${name}@${createHash("sha256").update(template).digest("hex").slice(0, 12)}`;
}

export function archivePrompt(dataRoot: string, name: string, template: string): { version: string; path: string } {
  const version = promptVersion(name, template);
  const dir = dataRootLayout(dataRoot).prompts;
  const path = join(dir, `${version}.md`);
  mkdirSync(dir, { recursive: true });
  placeTempFile(path, template, undefined, (tmp) => {
    try {
      linkSync(tmp, path);
    } catch (error) {
      if (!hasErrnoCode(error, ["EEXIST"])) throw error;
    }
  });
  return { version, path };
}
