// A fake claude. argv is <controlPath> ...args. It logs each call and then plays back the control file.
import { appendFileSync, readFileSync } from "node:fs";
import type { FakeClaudeControl } from "../helpers.js";

const [controlPath, ...args] = process.argv.slice(2);
const control = JSON.parse(readFileSync(controlPath!, "utf8")) as FakeClaudeControl & { logPath: string };

if (control.ignoreSigterm) process.on("SIGTERM", () => {});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((resolve) => stream.write(text, () => resolve()));
}

async function readStdin(): Promise<string> {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

const stdin = await readStdin();
appendFileSync(
  control.logPath,
  `${JSON.stringify({ argv: args, stdin, envNames: Object.keys(process.env).sort() })}\n`,
);

const isVersion = args.length === 1 && args[0] === "--version" && control.version !== undefined;
const answer = isVersion
  ? control.version!
  : {
      stdout: (control.stream ?? []).map((line) => `${line}\n`).join(""),
      stderr: control.stderr,
      exitCode: control.exitCode,
      sleepMs: control.sleepMs,
    };

if (answer.stdout) await write(process.stdout, answer.stdout);
if (answer.stderr) await write(process.stderr, answer.stderr);
if (answer.sleepMs) await sleep(answer.sleepMs);
if (!isVersion && control.killWith) process.kill(process.pid, control.killWith);
process.exitCode = answer.exitCode ?? 0;
