import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { shellQuote } from "../../src/vcs/git/ssh.js";
import { useTempDir } from "./temp.js";

// Writes an executable shell script named name into binDir. body is the script after "#!/bin/sh".
export function writeFakeCommand(binDir: string, name: string, body: string): void {
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// The shell line that appends one call to the log: the argument count, then each argument.
// Each item ends with a NUL, so an argument can hold a newline.
// Each item of extra (a piece of shell code) goes in the log before the arguments and counts in the argument count.
export function logLine(logPath: string, extra: readonly string[] = []): string {
  const count = extra.length === 0 ? '"$#"' : `"$(($# + ${extra.length}))"`;
  return `printf '%s\\0' ${[count, ...extra].join(" ")} "$@" >> ${shellQuote(logPath)}`;
}

// Reads a log of writeFakeSsh(), writeGitRecorder() or writeFakeGh(). It returns one argument list for each call.
// A missing log gives no calls.
export function readArgLog(logPath: string): string[][] {
  let text: string;
  try {
    text = readFileSync(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const items = text.split("\0");
  items.pop(); // The text after the last NUL is empty.
  const calls: string[][] = [];
  let index = 0;
  while (index < items.length) {
    const count = Number(items[index]);
    calls.push(items.slice(index + 1, index + 1 + count));
    index += 1 + count;
  }
  return calls;
}

// The first file with this name on process.env.PATH.
export function realCommandPath(name: string): string {
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    if (folder === "") continue;
    const candidate = join(folder, name);
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {
      // Not here. Try the next folder.
    }
  }
  throw new Error(`no ${name} found on PATH`);
}

// path with each folder that holds an entry named program replaced, in the same place, by a new
// temp folder (see useTempDir()) with links to the other entries. A folder with no such entry
// stays as it is. As a result, program is not found, and every other program of the path still runs.
// Call it inside a test.
export function usePathWithout(program: string, path: string): string {
  return path
    .split(delimiter)
    .map((folder) => {
      if (!existsSync(join(folder, program))) return folder;
      const copy = useTempDir("tasker-path-without-");
      for (const entry of readdirSync(folder)) {
        if (entry !== program) symlinkSync(join(folder, entry), join(copy, entry));
      }
      return copy;
    })
    .join(delimiter);
}

// Writes a fake bwrap and a fake socat (both exit 0) into binDir, except the names in except.
export function writeFakeSandboxPrograms(binDir: string, except: readonly string[] = []): void {
  for (const name of ["bwrap", "socat"]) {
    if (!except.includes(name)) writeFakeCommand(binDir, name, "exit 0");
  }
}

// A new temp folder (see useTempDir()) with a fake bwrap and a fake socat, except the names in except.
// It gives the folder. Call it inside a test.
export function useFakeSandboxBin(except: readonly string[] = []): string {
  const bin = join(useTempDir("tasker-bin-"), "bin");
  writeFakeSandboxPrograms(bin, except);
  return bin;
}
