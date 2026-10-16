// A fake claude. argv is <controlPath> ...args. It logs each call and then plays back the control file.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { FakeClaudeControl } from "../helpers/fake-claude.js";
import { writePlaceholder } from "./placeholder.js";

const [controlPath, ...args] = process.argv.slice(2);
const control = JSON.parse(readFileSync(controlPath, "utf8")) as FakeClaudeControl & { logPath: string };

if (control.ignoreSigterm) process.on("SIGTERM", () => {});
if (control.sigtermStream) {
  const text = control.sigtermStream.map((line) => `${line}\n`).join("");
  process.on("SIGTERM", () => process.stdout.write(text));
}

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
const isVersionCall = (argv: string[]): boolean =>
  argv.length === 1 && argv[0] === "--version" && control.version !== undefined;
// The runs before this call, from the log. A --version call is not a run.
const earlierRuns = existsSync(control.logPath)
  ? readFileSync(control.logPath, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .filter((line) => !isVersionCall((JSON.parse(line) as { argv: string[] }).argv)).length
  : 0;
const settingsIndex = args.indexOf("--settings");
const settings = settingsIndex === -1 ? undefined : (JSON.parse(args[settingsIndex + 1]) as unknown);
appendFileSync(
  control.logPath,
  `${JSON.stringify({ argv: args, stdin, envNames: Object.keys(process.env).sort(), settings })}\n`,
);

const isVersion = isVersionCall(args);
// The fields of turns[N] win over the top-level fields. A call past the list uses the top-level fields.
const turn = { ...control, ...(isVersion ? {} : control.turns?.[earlierRuns]) };
const answer = isVersion
  ? control.version!
  : {
      stdout: (turn.stream ?? []).map((line) => `${line}\n`).join(""),
      stderr: turn.stderr,
      exitCode: turn.exitCode,
      sleepMs: turn.sleepMs,
    };

if (!isVersion) for (const path of control.placeholders ?? []) writePlaceholder(process.cwd(), path);
if (!isVersion && turn.exec !== undefined) {
  const [program, ...programArgs] = turn.exec;
  const ran = spawnSync(program, programArgs, { cwd: process.cwd(), stdio: "ignore" });
  if (ran.status !== 0) {
    await write(process.stderr, `fake claude: exec failed: ${ran.error?.message ?? `exit ${ran.status}`}\n`);
    process.exit(99);
  }
}
if (answer.stdout) await write(process.stdout, answer.stdout);
if (answer.stderr) await write(process.stderr, answer.stderr);
if (answer.sleepMs) await sleep(answer.sleepMs);
if (!isVersion && turn.untilStopped) await new Promise(() => setInterval(() => {}, 60_000));
if (!isVersion && control.killWith) process.kill(process.pid, control.killWith);
process.exitCode = answer.exitCode ?? 0;
