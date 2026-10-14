import { spawn } from "node:child_process";
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
  child.stdout.on("data", (chunk: Buffer) => {
    const pieces = chunk.toString("utf8").split("\n");
    if (pieces[pieces.length - 1] === "") pieces.pop();
    for (const line of pieces) options.onLine(line);
  });
  options.onSpawn(pid);
  child.stdin.end(options.prompt, "utf8");
  return superviseGroup(child, pid, { deadline: options.deadline });
}
