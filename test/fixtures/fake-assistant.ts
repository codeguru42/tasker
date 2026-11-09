// A fake assistant (claude or codex). argv is <controlPath> ...args. It logs each call and then plays back the control file.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

const stdin = await readStdin();
function answersCall(candidate: { args: string[] }, callArgs: readonly string[]): boolean {
  return (
    candidate.args.length === 0 ||
    (candidate.args.length === callArgs.length && candidate.args.every((value, index) => value === callArgs[index]))
  );
}

const piControl = control as FakeClaudeControl & {
  answers?: {
    args: string[];
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    delaySeconds?: number;
    killWith?: string;
    stream?: unknown[];
    session?: unknown[];
    sessionFile?: string;
  }[];
  logEnv?: string[];
};
if (piControl.answers) {
  const envNames = Object.keys(process.env).sort();
  const matchingAnswers = piControl.answers.filter((candidate) => answersCall(candidate, args));
  const earlierMatchingCalls = existsSync(control.logPath)
    ? readFileSync(control.logPath, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => (JSON.parse(line) as { args: string[] }).args)
        .filter((previousArgs) => matchingAnswers.some((candidate) => answersCall(candidate, previousArgs))).length
    : 0;
  appendFileSync(
    control.logPath,
    `${JSON.stringify({ args, stdin, envNames, env: Object.fromEntries((piControl.logEnv ?? []).map((name) => [name, process.env[name]])) })}\n`,
  );
  const answer = matchingAnswers[Math.min(earlierMatchingCalls, matchingAnswers.length - 1)];
  if (!answer) {
    appendFileSync(`${control.logPath}.unanswered`, `${args.length}\0${args.join("\0")}\0`);
    await write(process.stderr, `fake pi: no answer for: ${args.join(" ")}\n`);
    process.exit(99);
  }
  const hasSession = args.includes("--session-id") || args.includes("--session");
  const dirIndex = args.indexOf("--session-dir");
  if (hasSession && (dirIndex < 0 || !args[dirIndex + 1])) {
    await write(process.stderr, "fake pi: --session-dir is required\n");
    process.exit(1);
  }
  const sessionDir = dirIndex < 0 ? undefined : args[dirIndex + 1];
  const sessionFlag = args.includes("--session") ? "--session" : undefined;
  if (sessionFlag) {
    const id = args[args.indexOf(sessionFlag) + 1];
    mkdirSync(sessionDir!, { recursive: true });
    if (!readdirSync(sessionDir!).some((name) => name.endsWith(`_${id}.jsonl`))) {
      await write(process.stderr, `No session found matching '${id}'\n`);
      process.exit(1);
    }
  }
  if (answer.delaySeconds) await sleep(answer.delaySeconds * 1000);
  if (answer.stderr) await write(process.stderr, answer.stderr);
  if (answer.stdout) await write(process.stdout, answer.stdout);
  if (answer.stream) {
    const stream = answer.stream.map((event) => `${JSON.stringify(event)}\n`).join("");
    await write(process.stdout, stream);
  }
  if (answer.session) {
    const idFlag = args.includes("--session-id") ? "--session-id" : "--session";
    const id = args[args.indexOf(idFlag) + 1];
    mkdirSync(sessionDir!, { recursive: true });
    const existing =
      idFlag === "--session" ? readdirSync(sessionDir!).find((name) => name.endsWith(`_${id}.jsonl`)) : undefined;
    if (idFlag === "--session" && !existing) {
      await write(process.stderr, `No session found matching '${id}'\n`);
      process.exit(1);
    }
    const firstEntry = answer.session[0] as { timestamp?: string } | undefined;
    const sessionFile =
      existing ?? answer.sessionFile ?? `${(firstEntry?.timestamp ?? "session").replace(/[:.]/g, "-")}_${id}.jsonl`;
    const path = join(sessionDir!, sessionFile);
    const entries = existing ? answer.session.slice(1) : answer.session;
    appendFileSync(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  }
  if (answer.killWith) {
    process.kill(process.pid, `SIG${answer.killWith}` as NodeJS.Signals);
    await new Promise(() => setInterval(() => {}, 60_000));
  }
  process.exit(answer.exitCode ?? 0);
}
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
    await write(process.stderr, `fake assistant: exec failed: ${ran.error?.message ?? `exit ${String(ran.status)}`}\n`);
    process.exit(99);
  }
}
if (answer.stdout) await write(process.stdout, answer.stdout);
if (answer.stderr) await write(process.stderr, answer.stderr);
if (answer.sleepMs) await sleep(answer.sleepMs);
if (!isVersion && turn.untilStopped) await new Promise(() => setInterval(() => {}, 60_000));
if (!isVersion && control.killWith) process.kill(process.pid, control.killWith);
process.exitCode = answer.exitCode ?? 0;
