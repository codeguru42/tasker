import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { type GroupResult, superviseGroup } from "./run-group.js";

const STDERR_TAIL_BYTES = 64 * 1024;

export interface RunAssistantOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  deadline: number;
  // Called once for each line of stdout, in order. It must not throw.
  onLine: (line: string) => void;
  onSpawn: (pid: number) => void;
  signal?: AbortSignal;
}

// Joins the chunks of one UTF-8 stream and gives each line, an empty line too, to onLine.
// The line end is "\n" only. The text after the last line end goes out when the stream ends.
function lineSplitter(onLine: (line: string) => void) {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  const take = (text: string) => {
    const pieces = (rest + text).split("\n");
    rest = pieces.pop() ?? "";
    for (const line of pieces) onLine(line);
  };
  return {
    write: (chunk: Buffer) => take(decoder.write(chunk)),
    end: () => {
      take(decoder.end());
      if (rest !== "") onLine(rest);
    },
  };
}

// Runs file with args as an assistant child in a new process group and session.
// The prompt goes to stdin, and stdin closes after it. Each line of stdout goes to onLine.
// The group, the deadline and the signals follow superviseGroup. Stderr never goes to the terminal.
// When the leader exits, the group is stopped as on an abort.
// The result holds the last 64 KiB of stderr.
export async function runAssistant(
  file: string,
  args: readonly string[],
  options: RunAssistantOptions,
): Promise<GroupResult & { stderrTail: string }> {
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pid = child.pid!;
  child.stdin.on("error", () => {}); // the result comes from the exit, and an EPIPE only means that the child exited before it read the whole prompt
  const splitter = lineSplitter(options.onLine);
  child.stdout.on("data", splitter.write);
  child.stdout.on("end", splitter.end);
  let tail = Buffer.alloc(0);
  child.stderr.on("data", (chunk: Buffer) => {
    tail = Buffer.concat([tail, chunk]).subarray(-STDERR_TAIL_BYTES);
  });
  options.onSpawn(pid);
  child.stdin.end(options.prompt, "utf8");
  const leaderExit = new AbortController();
  child.once("exit", () => leaderExit.abort());
  const signal = options.signal ? AbortSignal.any([options.signal, leaderExit.signal]) : leaderExit.signal;
  const result = await superviseGroup(child, pid, { deadline: options.deadline, signal });
  return { ...result, stderrTail: tail.toString("utf8") };
}
