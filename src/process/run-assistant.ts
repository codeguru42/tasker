import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { CommandNotFoundError, assertPathSet } from "./run-child.js";
import { type GroupResult, superviseGroup } from "./run-group.js";

const STDERR_TAIL_BYTES = 64 * 1024;

export interface RunAssistantOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  deadline: number;
  // Called once for each line of stdout, in order. It must not throw.
  onLine: (line: string) => void;
  // Called once with the pid of the leader, before the prompt goes to stdin. If it throws, the group stops
  // as for onStart of superviseGroup, and the run rejects with that error.
  onSpawn: (pid: number) => void;
  signal?: AbortSignal;
}

// Joins the chunks of one UTF-8 stream and gives each line, an empty line too, to onLine.
// The line end is "\n" only. The text after the last line end goes out when the stream closes.
function lineSplitter(onLine: (line: string) => void) {
  const decoder = new StringDecoder("utf8");
  let open: string[] = []; // the pieces of the line that has no line end yet
  const take = (text: string) => {
    let start = 0;
    for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n", start)) {
      open.push(text.slice(start, end));
      onLine(open.join(""));
      open = [];
      start = end + 1;
    }
    if (start < text.length) open.push(text.slice(start));
  };
  return {
    write: (chunk: Buffer) => take(decoder.write(chunk)),
    end: () => {
      take(decoder.end());
      if (open.length > 0) onLine(open.join(""));
    },
  };
}

// The tail can start inside a UTF-8 character. A character has at most 3 bytes after its first byte.
function decodeTail(tail: Buffer): string {
  let start = 0;
  while (start < 3 && start < tail.length && (tail[start]! & 0xc0) === 0x80) start++;
  return tail.subarray(start).toString("utf8");
}

export type AssistantResult =
  | (GroupResult & { started: true; stderrTail: string })
  | { started: false; notFound: boolean; error: string };

// Runs file with args as an assistant child in a new process group and session.
// The prompt goes to stdin, and stdin closes after it. Each line of stdout goes to onLine.
// The group, the deadline, the signals and the stop at the exit of the leader follow superviseGroup.
// Stderr never goes to the terminal.
// A start that fails gives started false and an error text. notFound is true when the program is missing or the env has no PATH.
// Otherwise, the result holds the last 64 KiB of stderr.
export async function runAssistant(
  file: string,
  args: readonly string[],
  options: RunAssistantOptions,
): Promise<AssistantResult> {
  try {
    assertPathSet(file, options.env);
  } catch (error) {
    return { started: false, notFound: true, error: (error as Error).message };
  }
  // Node gives the same ENOENT for a missing folder and a missing program, and it throws for a folder that is a file.
  if (statSync(options.cwd, { throwIfNoEntry: false })?.isDirectory() !== true) {
    return { started: false, notFound: false, error: `cannot start ${file}: the folder ${options.cwd} does not exist` };
  }
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pid = child.pid;
  if (pid === undefined) {
    const error = await new Promise<NodeJS.ErrnoException>((resolve) => child.once("error", resolve));
    if (error.code === "ENOENT") return { started: false, notFound: true, error: new CommandNotFoundError(file, "not-on-path").message };
    return { started: false, notFound: false, error: `cannot start ${file}: ${error.message}` };
  }
  child.stdin.on("error", () => {}); // the result comes from the exit, and an EPIPE only means that the child exited before it read the whole prompt
  const splitter = lineSplitter(options.onLine);
  child.stdout.on("data", splitter.write);
  child.stdout.once("close", splitter.end);
  let tail = Buffer.alloc(0);
  child.stderr.on("data", (chunk: Buffer) => {
    tail = Buffer.concat([tail, chunk]).subarray(-STDERR_TAIL_BYTES);
  });
  const supervised = superviseGroup(child, pid, {
    deadline: options.deadline,
    signal: options.signal,
    stopOnExit: true,
    onStart: () => options.onSpawn(pid),
  });
  child.stdin.end(options.prompt, "utf8");
  const result = await supervised;
  return { started: true, ...result, stderrTail: decodeTail(tail) };
}
