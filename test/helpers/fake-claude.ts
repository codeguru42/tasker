import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantEvent, RunInput } from "../../src/assistant/provider.js";
import { shellQuote } from "../../src/vcs/git/ssh.js";
import { writeFakeCommand } from "./fake-commands.js";
import { useProcessEnv, useTempDir, useTempHome } from "./temp.js";

// What the fake claude does (see useFakeClaude()).
export interface FakeClaudeControl {
  // The stdout lines. Each line gets a newline.
  stream?: string[];
  stderr?: string;
  exitCode?: number;
  // After the output is flushed, the fake sends this signal to itself.
  killWith?: NodeJS.Signals;
  // The wait after the output and before the exit.
  sleepMs?: number;
  // The fake ignores SIGTERM.
  ignoreSigterm?: boolean;
  // After the output, the fake keeps running until a signal stops it.
  untilStopped?: boolean;
  // Lines that the fake writes to stdout on SIGTERM. The fake then does not exit, so with untilStopped only
  // SIGKILL stops it. The lines come after the deadline of a run by construction.
  sigtermStream?: string[];
  // The answer when the only argument is --version.
  version?: { stdout: string; stderr?: string; exitCode?: number; sleepMs?: number };
  // Paths relative to the cwd of the fake. Before the output, the fake makes each one with writePlaceholder().
  // With killWith, this plays a killed claude that leaves placeholders.
  placeholders?: string[];
  // The answer of each call. Call N (from 0, a --version call does not count) uses the fields of turns[N] over the
  // top-level fields. A call past the end of the list uses the top-level fields.
  turns?: FakeClaudeTurn[];
  // A program and its arguments. Before the output, the fake runs it in its cwd. Use an absolute program path,
  // because the fake runs with the filtered child env. A program that fails makes the fake write one stderr line
  // and exit with 99.
  exec?: string[];
}

// The fields of FakeClaudeControl that one call can set for itself.
export type FakeClaudeTurn = Pick<
  FakeClaudeControl,
  "stream" | "stderr" | "exitCode" | "sleepMs" | "untilStopped" | "exec"
>;

// One call that the fake claude logged.
export interface FakeClaudeCall {
  argv: string[];
  stdin: string;
  // The sorted names of the env of the fake.
  envNames: string[];
  // The JSON of the argument after --settings, parsed. It is absent when the call has no --settings.
  settings?: unknown;
}

export interface FakeClaude {
  // The folder with the claude program. Put it on PATH.
  binDir: string;
  // A minimal env that finds the fake: PATH and HOME.
  env: { PATH: string; HOME: string };
  // The calls so far, in order. It gives [] when the fake never ran.
  calls(): FakeClaudeCall[];
}

// The lines of test/fixtures/claude-streams/<name>.jsonl, with no empty last item.
export function claudeSample(name: string): string[] {
  const path = fileURLToPath(new URL(`../fixtures/claude-streams/${name}.jsonl`, import.meta.url));
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

// Each line of a sample, parsed. Each call parses again, so each call gives new objects.
export function claudeSampleEvents(name: string): AssistantEvent[] {
  return claudeSample(name).map((line) => JSON.parse(line) as AssistantEvent);
}

// The events of a sample, with the last event (the result) changed by edit.
// The events come from a new parse, so the edit never reaches the sample file or a later read.
export function claudeSampleWithResult(name: string, edit: (result: AssistantEvent) => void): AssistantEvent[] {
  const events = claudeSampleEvents(name);
  edit(events.at(-1)!);
  return events;
}

// The real rate_limit_event of the sample rate-limit-warning (a capture from claude), new for each call,
// with its rate_limit_info changed by edit. A test names the changed field in its test name.
export function claudeRateLimitEvent(edit: (info: Record<string, unknown>) => void = () => {}): AssistantEvent {
  const event = claudeSampleEvents("rate-limit-warning")[0];
  edit(event.rate_limit_info as Record<string, unknown>);
  return event;
}

// The capture of claudeRateLimitEvent() with isUsingOverage true: an event that shows the start of paid usage.
// Then edit changes its rate_limit_info. A test names each field that edit changes in its test name.
export function claudeOverageEvent(edit: (info: Record<string, unknown>) => void = () => {}): AssistantEvent {
  return claudeRateLimitEvent((info) => {
    info.isUsingOverage = true;
    edit(info);
  });
}

// The stream with event as its first line, before the lines of stream, for a test where the event comes first.
export function withEventFirst(event: AssistantEvent, stream: readonly string[]): string[] {
  return [JSON.stringify(event), ...stream];
}

export const TEST_SESSION_ID = "e5f6ebac-a40e-48af-befc-f9a7d1af4c5b";

// The id of an execute session. It differs from TEST_SESSION_ID, because a session id is unique in the whole table.
export const TEST_EXECUTE_SESSION_ID = "3c9d1a52-7b4e-4f0a-9d86-2e5a8c1b7f34";

// The id of a review session. It differs from TEST_SESSION_ID and TEST_EXECUTE_SESSION_ID, because a session id is
// unique in the whole table.
export const TEST_REVIEW_SESSION_ID = "9b2e7d41-6c3a-4f58-8e1d-5a7c0f2b9e63";

// A run input with the defaults of the assistant provider tests, new for each call. Later tickets use it
// for each provider. A test that starts a child passes a real cwd and env.
export function runInput(overrides: Partial<RunInput> = {}): RunInput {
  return {
    sessionId: TEST_SESSION_ID,
    resume: false,
    prompt: "say hello",
    cwd: "/work",
    env: {},
    timeoutMs: 20_000,
    sessionDir: "/sessions",
    model: "haiku",
    effort: "low",
    ...overrides,
  };
}

// Makes a fake claude on a new temp folder, and removes it after the test. Call it inside a test.
// The fake gets its control only from a file, because childEnv() drops every other control name.
export function useFakeClaude(control: FakeClaudeControl): FakeClaude {
  const dir = useTempDir("tasker-fake-claude-");
  const binDir = join(dir, "bin");
  const logPath = join(dir, "calls.log");
  const controlPath = join(dir, "control.json");
  writeFileSync(controlPath, JSON.stringify({ ...control, logPath }));
  const fixture = fileURLToPath(new URL("../fixtures/fake-claude.ts", import.meta.url));
  const loader = import.meta.resolve("tsx");
  writeFakeCommand(
    binDir,
    "claude",
    `exec ${[process.execPath, "--import", loader, fixture, controlPath].map(shellQuote).join(" ")} "$@"`,
  );
  return {
    binDir,
    env: { PATH: binDir, HOME: dir },
    calls: () =>
      existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line) as FakeClaudeCall)
        : [],
  };
}

// Makes an empty file with mode 0o444, as bwrap leaves for a protected path. It lives in a fixture module
// that imports only node: modules, so that the fake claude starts fast.
export { writePlaceholder } from "../fixtures/placeholder.js";

// The argument after flag in argv of a claude call, for example the id after --session-id.
export function argAfter(argv: string[], flag: string): string | undefined {
  return argv[argv.indexOf(flag) + 1];
}

// useFakeClaude(control), then process.env gets the fake first on PATH and a temp HOME and XDG_CONFIG_HOME for this test.
// Call it inside a test.
export function useFakeClaudeOnPath(control: FakeClaudeControl): FakeClaude {
  const claude = useFakeClaude(control);
  useProcessEnv({ ...useTempHome(), PATH: `${claude.binDir}${delimiter}${String(process.env.PATH)}` });
  return claude;
}
