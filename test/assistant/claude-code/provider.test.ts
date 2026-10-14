import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCodeProvider } from "../../../src/assistant/claude-code/provider.js";
import type { AssistantEvent, RunInput, RunOutcome } from "../../../src/assistant/provider.js";
import {
  claudeSample,
  claudeSampleWithResult,
  type FakeClaude,
  type FakeClaudeControl,
  runInput,
  TEST_SESSION_ID,
  useFakeClaude,
  useTempDir,
  writeFakeSandboxPrograms,
} from "../../helpers.js";

function input(fake: FakeClaude, overrides: Partial<RunInput> = {}): RunInput {
  return runInput({ cwd: useTempDir("tasker-claude-cwd-"), env: fake.env, ...overrides });
}

function run(
  control: FakeClaudeControl,
  overrides: Partial<RunInput> = {},
): Promise<{ outcome: RunOutcome; fake: FakeClaude }> {
  const fake = useFakeClaude(control);
  return createClaudeCodeProvider()
    .run(input(fake, overrides))
    .then((outcome) => ({ outcome, fake }));
}

const lines = (events: AssistantEvent[]) => events.map((event) => JSON.stringify(event));

function failureOf(outcome: RunOutcome): Extract<RunOutcome, { kind: "failure" }> {
  expect(outcome.kind).toBe("failure");
  return outcome as Extract<RunOutcome, { kind: "failure" }>;
}

describe("createClaudeCodeProvider run", () => {
  it("runs claude with the argv and the prompt on stdin, and gives the events and the facts", async () => {
    const events: AssistantEvent[] = [];
    const pids: number[] = [];

    const { outcome, fake } = await run(
      { stream: claudeSample("plain") },
      { onEvent: (event) => events.push(event), onSpawn: (pid) => pids.push(pid) },
    );

    const calls = fake.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--session-id",
      TEST_SESSION_ID,
      "--model",
      "haiku",
      "--effort",
      "low",
    ]);
    expect(calls[0]!.stdin).toBe("say hello");
    expect(outcome).toEqual({
      kind: "success",
      sessionId: TEST_SESSION_ID,
      events,
      permissionDenials: [],
      usage: { inputTokens: 2, outputTokens: 4, cacheCreationInputTokens: 14964, cacheReadInputTokens: 10978 },
      reportedModel: "claude-haiku-5-5",
    });
    expect(events.map((event) => event["type"])).toEqual(["system", "assistant", "rate_limit_event", "result"]);
    expect(pids).toHaveLength(1);
    expect(pids[0]).toBeGreaterThan(0);
  });

  it("gives the child only the allowed names", async () => {
    const fake = useFakeClaude({ stream: claudeSample("plain") });
    const env = {
      ...fake.env,
      CLAUDE_CONFIG_DIR: "/claude-config",
      GH_TOKEN: "t",
      SSH_AUTH_SOCK: "/sock",
      ANTHROPIC_API_KEY: "k",
      ANTHROPIC_AUTH_TOKEN: "k",
      TASKER_CONFIG: "/config.json",
    };

    await createClaudeCodeProvider().run(input(fake, { env }));

    const names = fake.calls()[0]!.envNames;
    expect(names).toContain("CLAUDE_CONFIG_DIR");
    for (const name of ["GH_TOKEN", "SSH_AUTH_SOCK", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "TASKER_CONFIG"]) {
      expect(names).not.toContain(name);
    }
  });

  it("resumes a session with --resume", async () => {
    const { outcome, fake } = await run({ stream: claudeSample("resume") }, { resume: true });

    expect(outcome.kind).toBe("success");
    expect(fake.calls()[0]!.argv).toContain("--resume");
    expect(fake.calls()[0]!.argv).not.toContain("--session-id");
  });

  it("gives the structured output of a run with a schema", async () => {
    const schema = { type: "object" };

    const { outcome, fake } = await run({ stream: claudeSample("json-schema") }, { jsonSchema: schema });

    expect(outcome).toMatchObject({ kind: "success", structuredOutput: { word: "hello" } });
    expect(fake.calls()[0]!.argv).toContain(JSON.stringify(schema));
  });

  it("fails when a schema was given and the result has no structured output", async () => {
    const stream = lines(claudeSampleWithResult("json-schema", (result) => delete result["structured_output"]));

    const { outcome } = await run({ stream }, { jsonSchema: { type: "object" } });

    expect(failureOf(outcome)).toMatchObject({
      reason: "the assistant gave no structured answer",
      exitCode: 0,
      signal: null,
    });
  });

  it("does not give structured output when no schema was given", async () => {
    const { outcome } = await run({ stream: claudeSample("json-schema") });

    expect(outcome.kind).toBe("success");
    expect(outcome).not.toHaveProperty("structuredOutput");
  });

  it("fails with no result when the result line is missing and the exit code is 0", async () => {
    const { outcome } = await run({ stream: claudeSample("plain").slice(0, 3) });

    expect(failureOf(outcome)).toMatchObject({
      reason: "the assistant ended with no result",
      usage: "unavailable",
      exitCode: 0,
      signal: null,
    });
  });

  it("keeps the events before a cut last line, and fails with no result", async () => {
    const lines = claudeSample("plain");
    const stream = [...lines.slice(0, 3), lines[3]!.slice(0, 60)];
    const events: AssistantEvent[] = [];

    const { outcome } = await run({ stream }, { onEvent: (event) => events.push(event) });

    expect(events).toHaveLength(3);
    expect(failureOf(outcome)).toMatchObject({ reason: "the assistant ended with no result" });
    expect(outcome.events).toHaveLength(3);
  });

  it("fails with the text of a result that has is_error true, before the exit code", async () => {
    const stream = lines(
      claudeSampleWithResult("plain", (result) => {
      result["is_error"] = true;
      result["result"] = "Credit balance is too low";
      }),
    );

    const { outcome } = await run({ stream, exitCode: 1, stderr: "ignored" });

    expect(failureOf(outcome)).toMatchObject({
      reason: "Credit balance is too low",
      exitCode: 1,
      signal: null,
    });
  });

  it("falls back to the subtype when an error result has no text", async () => {
    const stream = lines(
      claudeSampleWithResult("plain", (result) => {
      result["is_error"] = true;
      result["subtype"] = "error_during_execution";
      delete result["result"];
      }),
    );

    const { outcome } = await run({ stream, exitCode: 1 });

    expect(failureOf(outcome).reason).toBe("the assistant ended with the error error_during_execution");
  });

  it("falls back to a general text when an error result has no text and no subtype", async () => {
    const stream = lines(
      claudeSampleWithResult("plain", (result) => {
      result["is_error"] = true;
      delete result["result"];
      delete result["subtype"];
      }),
    );

    const { outcome } = await run({ stream });

    expect(failureOf(outcome).reason).toBe("the assistant ended with an error");
  });

  it("gives the denials of a result that has is_error true", async () => {
    const stream = lines(
      claudeSampleWithResult("denied-tool", (result) => {
      result["is_error"] = true;
      }),
    );

    const { outcome } = await run({ stream });

    expect(failureOf(outcome).permissionDenials).toEqual([
      { tool: "Write", input: { file_path: "/work/note.txt", content: "hi" } },
    ]);
  });

  it("fails with the exit code and the stderr tail", async () => {
    const { outcome } = await run({ stream: claudeSample("plain"), exitCode: 2, stderr: "boom\n" });

    expect(failureOf(outcome)).toMatchObject({ reason: "claude exited 2: boom", exitCode: 2, signal: null });
  });

  it("fails with the exit code alone when stderr is empty", async () => {
    const { outcome } = await run({ stream: claudeSample("plain"), exitCode: 2 });

    expect(failureOf(outcome).reason).toBe("claude exited 2");
  });

  it("fails when claude is killed by a signal", async () => {
    const { outcome } = await run({ stream: claudeSample("plain").slice(0, 2), killWith: "SIGKILL" });

    expect(failureOf(outcome)).toMatchObject({
      reason: "claude was killed by SIGKILL",
      exitCode: null,
      signal: "SIGKILL",
    });
    expect(outcome.events).toHaveLength(2);
  });

  it("gives timeout at the deadline, before the exit code", async () => {
    const { outcome } = await run({ stream: claudeSample("plain").slice(0, 2), sleepMs: 20_000, exitCode: 3 }, { timeoutMs: 500 });

    expect(outcome.kind).toBe("timeout");
    expect(outcome.events).toHaveLength(2);
  });

  it("gives timeout when claude ignores SIGTERM", { timeout: 15_000 }, async () => {
    const { outcome } = await run({ stream: [], sleepMs: 60_000, ignoreSigterm: true }, { timeoutMs: 500 });

    expect(outcome.kind).toBe("timeout");
  });

  it("refuses an overage stop before it starts claude", async () => {
    const { outcome, fake } = await run({ stream: claudeSample("plain") }, { overageStop: {} });

    expect(failureOf(outcome)).toMatchObject({
      reason: "the claude-code provider cannot enforce an overage stop in this version",
      exitCode: null,
      signal: null,
      events: [],
      usage: "unavailable",
    });
    expect(fake.calls()).toEqual([]);
  });

  it("fails when claude is not on PATH", async () => {
    const fake = useFakeClaude({ stream: claudeSample("plain") });
    const emptyBin = join(useTempDir("tasker-empty-bin-"), "bin");
    mkdirSync(emptyBin);

    const outcome = await createClaudeCodeProvider().run(input(fake, { env: { PATH: emptyBin, HOME: emptyBin } }));

    expect(failureOf(outcome)).toMatchObject({
      reason: "claude is not installed or not on PATH",
      exitCode: null,
      signal: null,
    });
    expect(fake.calls()).toEqual([]);
  });

  it("drops an error that onEvent throws", async () => {
    const { outcome, fake } = await run(
      { stream: claudeSample("plain") },
      {
        onEvent: () => {
          throw new Error("listener broke");
        },
      },
    );

    expect(outcome.kind).toBe("success");
    expect(outcome.events).toHaveLength(4);
    expect(fake.calls()).toHaveLength(1);
  });

  it("gives a failure when onSpawn throws", async () => {
    const { outcome } = await run(
      { stream: claudeSample("plain") },
      {
        onSpawn: () => {
          throw new Error("spawn listener broke");
        },
      },
    );

    expect(failureOf(outcome)).toMatchObject({ reason: "spawn listener broke" });
  });
});

describe("createClaudeCodeProvider run with a sandbox", () => {
  const tracked = async () => [] as string[];
  const limits = {
    allowWrite: ["/work/wt"],
    denyRead: ["/home/test/key"],
    trackedPaths: tracked,
    sharedFolder: "/work/clones/owner-repo/bare-repo",
  };

  // A sandboxed run on a fake linux host. The fake has bwrap and socat, except the names in except.
  async function sandboxed(
    control: FakeClaudeControl,
    options: { platform?: NodeJS.Platform; except?: string[]; sharedFolder?: string; timeoutMs?: number } = {},
  ) {
    const fake = useFakeClaude(control);
    writeFakeSandboxPrograms(fake.binDir, options.except ?? []);
    const tmpRoot = realpathSync(useTempDir("tasker-claude-tmp-"));
    const cwd = useTempDir("tasker-claude-cwd-");
    const outcome = await createClaudeCodeProvider({ platform: options.platform ?? "linux", tmpRoot }).run(
      runInput({ cwd, env: fake.env, sandbox: { ...limits, ...(options.sharedFolder ? { sharedFolder: options.sharedFolder } : {}) }, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) }),
    );
    return { outcome, fake, tmpRoot, cwd };
  }

  it("gives claude the settings, with no way out of the sandbox and the one socket folder", async () => {
    const { outcome, fake, tmpRoot } = await sandboxed({ stream: claudeSample("plain") });

    expect(outcome.kind).toBe("success");
    const call = fake.calls()[0]!;
    expect(call.settings).toEqual({
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        filesystem: { allowWrite: ["/work/wt"], denyRead: ["/home/test/key"] },
        network: { allowedDomains: ["*"], allowUnixSockets: [join(tmpRoot, `claude-${process.getuid!()}`)] },
      },
    });
    expect(call.argv).toContain("--settings");
  });

  it("gives a cleanup with nothing removed for a run with no placeholder", async () => {
    const { outcome } = await sandboxed({ stream: claudeSample("plain") });

    expect(outcome).toMatchObject({ sandboxCleanup: { removed: [] } });
  });

  it("gives no settings and no cleanup for a run with no sandbox", async () => {
    const { outcome, fake } = await run({ stream: claudeSample("plain") });

    expect(fake.calls()[0]!.argv).not.toContain("--settings");
    expect(fake.calls()[0]!).not.toHaveProperty("settings");
    expect(outcome).not.toHaveProperty("sandboxCleanup");
  });

  it("removes the placeholders of a killed claude and reports them sorted", async () => {
    const { outcome, cwd } = await sandboxed({
      stream: claudeSample("plain").slice(0, 2),
      placeholders: [".zshrc", ".bashrc", ".claude/settings.json"],
      killWith: "SIGKILL",
    });

    const failure = failureOf(outcome);
    expect(failure.signal).toBe("SIGKILL");
    expect(failure.sandboxCleanup).toEqual({ removed: [".bashrc", ".claude", ".claude/settings.json", ".zshrc"] });
    for (const name of [".zshrc", ".bashrc", ".claude"]) expect(existsSync(join(cwd, name))).toBe(false);
  });

  it("gives the cleanup for a timeout too", { timeout: 20_000 }, async () => {
    const { outcome, cwd } = await sandboxed(
      { stream: [], placeholders: [".bashrc"], sleepMs: 15_000 },
      { timeoutMs: 3000 },
    );

    expect(outcome.kind).toBe("timeout");
    expect(outcome).toMatchObject({ sandboxCleanup: { removed: [".bashrc"] } });
    expect(existsSync(join(cwd, ".bashrc"))).toBe(false);
  });

  it("refuses a platform that is not linux or darwin before it starts claude", async () => {
    const { outcome, fake } = await sandboxed({ stream: claudeSample("plain") }, { platform: "win32" });

    expect(outcome).toEqual({
      kind: "failure",
      sessionId: TEST_SESSION_ID,
      events: [],
      permissionDenials: [],
      usage: "unavailable",
      exitCode: null,
      signal: null,
      reason: "the claude-code provider cannot enforce a sandbox on win32",
    });
    expect(fake.calls()).toEqual([]);
  });

  it("refuses when bwrap is missing, with no cleanup", async () => {
    const { outcome, fake } = await sandboxed({ stream: claudeSample("plain") }, { except: ["bwrap"] });

    expect(failureOf(outcome).reason).toBe("the claude-code sandbox needs bwrap, and bwrap is not on PATH");
    expect(outcome).not.toHaveProperty("sandboxCleanup");
    expect(fake.calls()).toEqual([]);
  });

  it("refuses a shared git folder with a name that ends in .git, with no cleanup", async () => {
    const { outcome, fake } = await sandboxed(
      { stream: claudeSample("plain") },
      { sharedFolder: "/work/clones/x.git" },
    );

    expect(failureOf(outcome).reason).toBe(
      "the shared git folder of the worktree has a name that ends in .git, and claude then makes all of it writable",
    );
    expect(outcome).not.toHaveProperty("sandboxCleanup");
    expect(fake.calls()).toEqual([]);
  });

  it("runs when the name of the shared folder holds .git but does not end in it", async () => {
    const { outcome, fake } = await sandboxed(
      { stream: claudeSample("plain") },
      { sharedFolder: "/work/clones/owner-repo/x.git-old" },
    );

    expect(outcome.kind).toBe("success");
    expect(fake.calls()).toHaveLength(1);
  });
});
