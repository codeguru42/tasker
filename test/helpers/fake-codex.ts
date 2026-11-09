import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { DOCKER_SOCKET_PATH } from "../../src/assistant/shared-sandbox-paths.js";
import type { AssistantEvent, Effort, TokenUsage } from "../../src/assistant/provider.js";
import {
  answerChecks,
  type FakeAnswer,
  fakeAnswerScript,
  logEnvItems,
  readFakeCalls,
  writeFakeCommand,
} from "./fake-commands.js";
import { type FakeClaude, type FakeClaudeControl, useFakeAssistant } from "./fake-claude.js";
import { useTempDir } from "./temp.js";

// The arguments of the version call.
export const CODEX_VERSION_ARGS: readonly string[] = ["--version"];

// The arguments of the login call.
export const CODEX_LOGIN_STATUS_ARGS: readonly string[] = ["login", "status"];

// The measured answer of `codex login status` with no login, on codex-cli 0.166.0.
export const MEASURED_LOGGED_OUT: Omit<FakeAnswer, "args"> = { exitCode: 1, stdout: "", stderr: "Not logged in\n" };

export interface FakeCodex {
  // PATH is the folder of the fake codex alone. HOME is the temp folder.
  env: { PATH: string; HOME: string };
  // One entry for each call. env holds each name of logEnv, and undefined for a name that was not set.
  calls(): { args: string[]; env: Record<string, string | undefined> }[];
}

// A fake codex in a new temp folder (see useTempDir()). A call with no answer fails the test.
// Call it inside a test.
export function useFakeCodex(answers: readonly FakeAnswer[], logEnv: readonly string[] = []): FakeCodex {
  const dir = useTempDir("tasker-fake-codex-");
  const bin = join(dir, "bin");
  const logPath = join(dir, "codex.log");
  writeFakeCommand(bin, "codex", fakeAnswerScript("codex", logPath, answers, logEnvItems("codex", logEnv)));
  answerChecks("codex", logPath);
  return {
    env: { PATH: bin, HOME: dir },
    calls: () => readFakeCalls(logPath, 0, logEnv).map((call) => ({ args: call.args, env: call.env })),
  };
}

// A fake codex that plays a stream, under the program name codex. It logs argv and stdin of each call.
// Call it inside a test.
export function useFakeCodexRun(control: FakeClaudeControl): FakeClaude {
  return useFakeAssistant("codex", control);
}

// The lines of test/fixtures/codex-streams/<name>.jsonl, with no empty last item.
export function codexSample(name: string): string[] {
  const path = fileURLToPath(new URL(`../fixtures/codex-streams/${name}.jsonl`, import.meta.url));
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

// Each line of a sample, parsed. Each call parses again, so each call gives new objects.
export function codexSampleEvents(name: string): AssistantEvent[] {
  return codexSample(name).map((line) => JSON.parse(line) as AssistantEvent);
}

export interface ExpectedCodexArgs {
  model: string;
  effort: Effort;
  // The paths of the write keys, before the deny keys. A path that is also denied gives one key, with deny.
  writePaths?: readonly string[];
  // The paths of the deny table. A repeated path gives one key.
  denyRead?: readonly string[];
  // The command of the PreToolUse hook. Without it, the list has no hook arguments.
  hookCommand?: string;
  // With a thread id, the list is the list of a continued session.
  threadId?: string;
  schemaPath?: string;
}

// The argument list of one codex run, written out from literal text, never from codexArgs(). The Docker key uses
// the host path because the expected table changes when that socket exists.
export function expectedCodexArgs(expected: ExpectedCodexArgs): string[] {
  const table = new Map<string, string>([["/", "read"]]);
  for (const path of expected.writePaths ?? []) table.set(path, "write");
  for (const path of expected.denyRead ?? []) table.set(path, "deny");
  try {
    table.set(realpathSync(DOCKER_SOCKET_PATH), "deny");
  } catch {
    // The host has no Docker socket.
  }
  const keys = [...table].map(([path, access]) => `${JSON.stringify(path)}="${access}"`);
  return [
    "exec",
    ...(expected.threadId === undefined ? [] : ["resume"]),
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    "-m",
    expected.model,
    "-c",
    `model_reasoning_effort="${expected.effort}"`,
    "-c",
    `approval_policy="never"`,
    "-c",
    `web_search="disabled"`,
    "-c",
    "features.apps=false",
    "-c",
    `default_permissions="tasker"`,
    "-c",
    `permissions.tasker.filesystem={${keys.join(", ")}}`,
    "-c",
    "permissions.tasker.network.enabled=true",
    ...(expected.hookCommand === undefined
      ? []
      : [
          "-c",
          `hooks.PreToolUse=[{matcher="^apply_patch$", hooks=[{type="command", command=${JSON.stringify(expected.hookCommand)}, timeout=10}]}]`,
          "--dangerously-bypass-hook-trust",
        ]),
    ...(expected.schemaPath === undefined ? [] : ["--output-schema", expected.schemaPath]),
    ...(expected.threadId === undefined ? [] : [expected.threadId]),
    "-",
  ];
}

// The thread id of plain.jsonl and resume.jsonl.
export const CODEX_THREAD_ID = "01a194bc-1d2f-77b2-a52d-5be299f7ea30";

// The usage of plain.jsonl, and the stored total before resume.jsonl.
export const CODEX_PLAIN_USAGE: TokenUsage = {
  inputTokens: 7889,
  outputTokens: 6,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 13184,
};

// The usage of resume.jsonl after CODEX_PLAIN_USAGE: the total of that file minus the total of plain.jsonl.
export const CODEX_RESUME_USAGE: TokenUsage = {
  inputTokens: 26007,
  outputTokens: 16,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};
