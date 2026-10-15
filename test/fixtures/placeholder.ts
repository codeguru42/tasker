// Makes an empty file with mode 0o444 at root/relative, and the parent folders. This is what bwrap leaves
// for a protected path that does not exist. It imports only node: modules, because the fake claude
// imports it, and a fixture that loads a file under test/helpers/ at run time starts too slowly for the deadline tests.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function writePlaceholder(root: string, relative: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "", { mode: 0o444 });
  chmodSync(path, 0o444);
}
