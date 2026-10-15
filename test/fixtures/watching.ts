import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Writes the pid of this process to the file watching in dir. A signal fixture calls it in onSpawn.
// At that time, the runner forwards the signals of this process to the group of the child.
export function markWatching(dir: string): void {
  writeFileSync(join(dir, "watching"), `${process.pid}\n`);
}
