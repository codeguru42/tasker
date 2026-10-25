import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { isRunnableFile } from "../../src/process/resolve-program.js";
import { shellQuote } from "../../src/shell-quote.js";
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

// One canned answer of a fake command. args is the whole argument list. It must match exactly, in order.
// When two answers have the same args, the first one wins.
export interface FakeAnswer {
  args: readonly string[];
  stdout?: string; // default ""
  stderr?: string; // default ""
  exitCode?: number; // default 0
  // A signal name such as "TERM": the fake prints its output, then stops itself with this signal.
  killWith?: string;
  // The fake runs the real sleep for this many seconds before it prints its output.
  delaySeconds?: number;
}

const signalNamePattern = /^[A-Z0-9]+$/;

// The script body of a fake command named tool. It logs each call at logPath (see logLine() for extra), then
// prints the first answer that matches. A call that no answer matches goes in the log <logPath>.unanswered,
// prints an error and exits with 99. It uses shell builtins. Only for a delay, it runs the real sleep by its
// absolute path.
export function fakeAnswerScript(
  tool: string,
  logPath: string,
  answers: readonly FakeAnswer[],
  extra: readonly string[],
): string {
  const body = [logLine(logPath, extra)];
  for (const answer of answers) {
    const conditions = [
      `[ $# -eq ${answer.args.length} ]`,
      ...answer.args.map((arg, index) => `[ "\${${index + 1}}" = ${shellQuote(arg)} ]`),
    ];
    const lines = [`if ${conditions.join(" && ")}; then`];
    if (answer.delaySeconds !== undefined) {
      if (!/^\d+(\.\d+)?$/.test(String(answer.delaySeconds))) {
        throw new Error(`bad delay for the fake ${tool}: ${answer.delaySeconds}`);
      }
      lines.push(`  ${shellQuote(realCommandPath("sleep"))} ${answer.delaySeconds}`);
    }
    lines.push(
      `  printf '%s' ${shellQuote(answer.stdout ?? "")}`,
      `  printf '%s' ${shellQuote(answer.stderr ?? "")} >&2`,
    );
    if (answer.killWith !== undefined) {
      if (!signalNamePattern.test(answer.killWith)) {
        throw new Error(`bad signal name for the fake ${tool}: ${answer.killWith}`);
      }
      lines.push(`  kill -${answer.killWith} $$`);
    }
    lines.push(`  exit ${answer.exitCode ?? 0}`, "fi");
    body.push(...lines);
  }
  body.push(logLine(`${logPath}.unanswered`), `printf 'fake ${tool}: no answer for: %s\\n' "$*" >&2`, "exit 99");
  return body.join("\n");
}

const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The log item of each name for fakeAnswerScript(): "${NAME+set:$NAME}". readFakeCalls() reads it.
// It throws `bad env name for the fake ${tool}: ${name}` for a name that is not a shell variable name.
export function logEnvItems(tool: string, names: readonly string[]): string[] {
  return names.map((name) => {
    if (!envNamePattern.test(name)) throw new Error(`bad env name for the fake ${tool}: ${name}`);
    return `"\${${name}+set:$${name}}"`;
  });
}

// Reads a log of fakeAnswerScript(). The first leading items of a call and then one item for each name of
// logEnv are logged values: an empty item gives undefined, and "set:<value>" gives <value>.
export function readFakeCalls(
  logPath: string,
  leading: number,
  logEnv: readonly string[],
): { leading: (string | undefined)[]; args: string[]; env: Record<string, string | undefined> }[] {
  const fromLog = (item: string) => (item === "" ? undefined : item.slice("set:".length));
  return readArgLog(logPath).map((items) => ({
    leading: items.slice(0, leading).map(fromLog),
    args: items.slice(leading + logEnv.length),
    env: Object.fromEntries(logEnv.map((name, index) => [name, fromLog(items[leading + index])])),
  }));
}

// The first file with this name on process.env.PATH.
export function realCommandPath(name: string): string {
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    if (folder === "") continue;
    const candidate = join(folder, name);
    if (isRunnableFile(candidate)) return candidate;
  }
  throw new Error(`no ${name} found on PATH`);
}

// The PATH text with folder first, then the PATH of base. It gives folder alone when base has no
// PATH or an empty PATH.
export function pathWithFirst(folder: string, base: NodeJS.ProcessEnv): string {
  return base.PATH === undefined || base.PATH === "" ? folder : `${folder}${delimiter}${base.PATH}`;
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
