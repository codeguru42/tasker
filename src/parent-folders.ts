import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Makes the missing parent folders of a path. It makes no entry at the path itself.
export function makeParentFolders(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}
