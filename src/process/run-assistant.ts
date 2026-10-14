import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { type GroupResult, superviseGroup } from "./run-group.js";

export interface RunAssistantOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  prompt: string;
  deadline: number;
  // Called once for each line of stdout, in order. It must not throw.
  onLine: (line: string) => void;
  onSpawn: (pid: number) => void;
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
// The group, the deadline and the signals follow superviseGroup.
export function runAssistant(
  file: string,
  args: readonly string[],
  options: RunAssistantOptions,
): Promise<GroupResult> {
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pid = child.pid!;
  child.stdin.on("error", () => {}); // the result comes from the exit, and an EPIPE only means that the child exited before it read the whole prompt
  const splitter = lineSplitter(options.onLine);
  child.stdout.on("data", splitter.write);
  child.stdout.on("end", splitter.end);
  options.onSpawn(pid);
  child.stdin.end(options.prompt, "utf8");
  return superviseGroup(child, pid, { deadline: options.deadline });
}
