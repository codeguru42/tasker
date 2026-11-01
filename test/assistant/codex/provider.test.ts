import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCodexProvider } from "../../../src/assistant/codex/provider.js";
import { readThreadId, readUsageTotal, writeThreadId, writeUsageTotal } from "../../../src/assistant/codex/session.js";
import type { AssistantEvent, AssistantProvider, RunInput, RunOutcome } from "../../../src/assistant/provider.js";
import { codexSchemaPath, codexUsagePath } from "../../../src/store/layout.js";
import { parseConfig } from "../../../src/config/schema.js";
import { validConfig } from "../../helpers/config.js";
import { TEST_SESSION_ID, runInput, type FakeClaude, type FakeClaudeControl } from "../../helpers/fake-claude.js";
import {
  CODEX_PLAIN_USAGE,
  CODEX_RESUME_USAGE,
  codexSample,
  codexSampleEvents,
  expectedCodexArgs,
  useFakeCodexRun,
} from "../../helpers/fake-codex.js";
import { useTempDir } from "../../helpers/temp.js";

function codexProvider(): AssistantProvider {
  return createCodexProvider();
}

const repo = () => {
  const tasker = parseConfig(validConfig(), {}, "/home/me").repos.tasker;
  return { key: "tasker", assistant: { ...tasker.assistant, provider: "codex" as const } };
};

describe("createCodexProvider", () => {
  it("has the id codex", () => {
    expect(codexProvider().id).toBe("codex");
  });

  it("gives no doctor check for no repo", () => {
    expect(codexProvider().doctorChecks([])).toEqual([]);
  });

  it.each([1, 2])("gives the version and login checks once for %i repos", (count) => {
    const repos = Array.from({ length: count }, () => repo());

    expect(
      codexProvider()
        .doctorChecks(repos)
        .map((check) => check.name),
    ).toEqual(["codex version", "codex login"]);
  });

  it("gives no model check", () => {
    expect(codexProvider().modelChecks("gpt-5")).toEqual([]);
  });

  it("has no quota behavior", () => {
    const provider = codexProvider();
    const outcome: RunOutcome = {
      kind: "success",
      sessionId: TEST_SESSION_ID,
      events: [],
      permissionDenials: [],
      usage: "unavailable",
    };

    expect(provider.detectQuotaApprovalWarning(outcome, 0.9)).toBeUndefined();
    expect(provider.isQuotaEvent({})).toBe(false);
    expect(provider.shouldSuppressQuotaApprovalPause({ utilization: 0.95 }, 1)).toBe(false);
  });
});

const THREAD_ID = "01a194bc-1d2f-77b2-a52d-5be299f7ea30";
const NO_THREAD = `the codex session ${TEST_SESSION_ID} has no thread id, so the run cannot continue it`;

interface Setup {
  fake: FakeClaude;
  sessionDir: string;
  input: RunInput;
}

// A fake codex, a temp cwd and a temp sessionDir. A continued run gets its thread id file first.
function setUp(control: FakeClaudeControl, overrides: Partial<RunInput> = {}, threadId?: string): Setup {
  const fake = useFakeCodexRun(control);
  const sessionDir = useTempDir("tasker-codex-sessions-");
  if (threadId !== undefined) writeThreadId(sessionDir, TEST_SESSION_ID, threadId);
  const input = runInput({
    cwd: useTempDir("tasker-codex-cwd-"),
    env: fake.env,
    sessionDir,
    ...overrides,
    ...(threadId === undefined ? {} : { resume: true }),
  });
  return { fake, sessionDir, input };
}

async function run(control: FakeClaudeControl, overrides: Partial<RunInput> = {}, threadId?: string) {
  const setup = setUp(control, overrides, threadId);
  const outcome = await codexProvider().run(setup.input);
  return { ...setup, outcome };
}

function failureOf(outcome: RunOutcome): Extract<RunOutcome, { kind: "failure" }> {
  expect(outcome.kind).toBe("failure");
  return outcome as Extract<RunOutcome, { kind: "failure" }>;
}

describe("createCodexProvider run: the outcome rows", () => {
  it("fails when codex is not on PATH", async () => {
    const setup = setUp({ stream: codexSample("plain") });
    const emptyBin = join(useTempDir("tasker-empty-bin-"), "bin");
    mkdirSync(emptyBin);

    const outcome = await codexProvider().run({ ...setup.input, env: { PATH: emptyBin, HOME: emptyBin } });

    expect(failureOf(outcome)).toMatchObject({
      reason: "codex is not installed or not on PATH",
      exitCode: null,
      signal: null,
    });
    expect(setup.fake.calls()).toEqual([]);
  });

  it("fails with the start error when the cwd does not exist", async () => {
    const { outcome, fake } = await run({ stream: codexSample("plain") }, { cwd: "/tasker-no-such-folder" });

    expect(failureOf(outcome).reason).not.toBe("codex is not installed or not on PATH");
    expect(failureOf(outcome).exitCode).toBeNull();
    expect(fake.calls()).toEqual([]);
  });

  it.each(["SIGINT", "SIGTERM"] as const)("gives interrupted when tasker passes %s", async (signal) => {
    const { outcome } = await run(
      { stream: codexSample("plain").slice(0, 2), untilStopped: true },
      { onSpawn: () => process.kill(process.pid, signal) },
    );

    expect(outcome).toMatchObject({ kind: "interrupted", signal });
  });

  it("gives timeout at the deadline, before the exit code", { timeout: 15_000 }, async () => {
    const { outcome } = await run(
      { stream: codexSample("plain").slice(0, 2), sleepMs: 20_000, exitCode: 3 },
      { timeoutMs: 3000 },
    );

    expect(outcome.kind).toBe("timeout");
    expect(outcome.events).toHaveLength(2);
  });

  it("fails when codex is killed by a signal", async () => {
    const { outcome } = await run({ stream: codexSample("plain").slice(0, 2), killWith: "SIGKILL" });

    expect(failureOf(outcome)).toMatchObject({
      reason: "codex was killed by SIGKILL",
      exitCode: null,
      signal: "SIGKILL",
    });
  });

  it("gives the message of the failure event, not the exit code", async () => {
    const { outcome } = await run({ stream: codexSample("turn-failed"), exitCode: 1 });

    const failed = codexSampleEvents("turn-failed").find((event) => event.type === "turn.failed")!;
    expect(failureOf(outcome)).toMatchObject({
      reason: (failed.error as { message: string }).message,
      exitCode: 1,
    });
  });

  it("fails with the exit code and the end of stderr", async () => {
    const { outcome } = await run({ stream: codexSample("plain"), exitCode: 3, stderr: "boom\n" });

    expect(failureOf(outcome)).toMatchObject({ reason: "codex exited 3: boom", exitCode: 3, signal: null });
  });

  it("fails when the stream has no turn.completed", async () => {
    const { outcome } = await run({ stream: codexSample("plain").slice(0, 3) });

    expect(failureOf(outcome).reason).toBe("the assistant ended with no result");
  });

  it("fails when a schema is set and the answer is not JSON", async () => {
    const { outcome } = await run({ stream: codexSample("plain") }, { jsonSchema: { type: "object" } });

    expect(failureOf(outcome).reason).toBe("the assistant gave no structured answer");
  });

  it("gives success for plain.jsonl, with the events and the pid", async () => {
    const events: AssistantEvent[] = [];
    const pids: number[] = [];

    const { outcome } = await run(
      { stream: codexSample("plain") },
      { onEvent: (event) => events.push(event), onSpawn: (pid) => pids.push(pid) },
    );

    expect(outcome).toMatchObject({ kind: "success", sessionId: TEST_SESSION_ID, permissionDenials: [] });
    expect(outcome.events).toEqual(codexSampleEvents("plain"));
    expect(events).toEqual(codexSampleEvents("plain"));
    expect(pids).toHaveLength(1);
  });

  it("gives the parsed answer as structuredOutput and writes the schema file", async () => {
    const jsonSchema = { type: "object", properties: { findings: { type: "array" } } };

    const { outcome, sessionDir } = await run({ stream: codexSample("json-schema") }, { jsonSchema });

    expect(outcome.kind).toBe("success");
    const answer = (outcome as { structuredOutput: { findings: unknown[] } }).structuredOutput;
    expect(answer.findings).toHaveLength(2);
    expect(JSON.parse(readFileSync(codexSchemaPath(sessionDir, TEST_SESSION_ID), "utf8"))).toEqual(jsonSchema);
  });

  it("fails with no call when the schema file cannot be written", async () => {
    const { outcome, fake } = await run(
      { stream: codexSample("json-schema") },
      { jsonSchema: { type: "object" }, sessionDir: join(useTempDir("tasker-codex-none-"), "missing") },
    );

    expect(failureOf(outcome).exitCode).toBeNull();
    expect(fake.calls()).toEqual([]);
  });
});

describe("createCodexProvider run: the thread id", () => {
  it("writes the thread id file at thread.started", async () => {
    const { sessionDir } = await run({ stream: codexSample("plain") });

    expect(readThreadId(sessionDir, TEST_SESSION_ID)).toBe(THREAD_ID);
  });

  it("passes the id from the file to a continued run", async () => {
    const { fake } = await run({ stream: codexSample("plain") }, {}, "T-from-file");

    expect(fake.calls()[0].argv).toEqual(expectedCodexArgs({ model: "haiku", effort: "low", threadId: "T-from-file" }));
  });

  it("fails with no call when a continued run has no thread id file", async () => {
    const { outcome, fake } = await run({ stream: codexSample("plain") }, { resume: true });

    expect(failureOf(outcome).reason).toBe(NO_THREAD);
    expect(fake.calls()).toEqual([]);
  });

  it("leaves no file after a killed run before thread.started, and the next run starts no child", async () => {
    const first = await run({ stream: [], killWith: "SIGKILL" });

    expect(readThreadId(first.sessionDir, TEST_SESSION_ID)).toBeUndefined();
    const next = await codexProvider().run({ ...first.input, resume: true });
    expect(failureOf(next).reason).toBe(NO_THREAD);
    expect(first.fake.calls()).toHaveLength(1);
  });

  it("gives the session id and never the thread id in the outcome", async () => {
    for (const control of [{ stream: codexSample("plain") }, { stream: codexSample("plain"), exitCode: 3 }]) {
      const { outcome } = await run(control);

      expect(outcome.sessionId).toBe(TEST_SESSION_ID);
      expect(JSON.stringify({ ...outcome, events: [] })).not.toContain(THREAD_ID);
    }
  });

  it("gives its normal success with a sessionDir that does not exist, and a later continued run fails", async () => {
    const sessionDir = join(useTempDir("tasker-codex-none-"), "missing");

    const first = await run({ stream: codexSample("plain") }, { sessionDir });
    const second = await codexProvider().run({ ...first.input, resume: true });

    expect(first.outcome.kind).toBe("success");
    expect(failureOf(second).reason).toBe(NO_THREAD);
    expect(first.fake.calls()).toHaveLength(1);
  });
});

describe("createCodexProvider run: the arguments and the env", () => {
  it("passes the arguments of a new session", async () => {
    const { fake } = await run({ stream: codexSample("plain") });

    expect(fake.calls()[0].argv).toEqual(expectedCodexArgs({ model: "haiku", effort: "low" }));
  });

  it("passes the arguments of a new session with a schema", async () => {
    const { fake, sessionDir } = await run({ stream: codexSample("plain") }, { jsonSchema: { type: "object" } });

    expect(fake.calls()[0].argv).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        schemaPath: codexSchemaPath(sessionDir, TEST_SESSION_ID),
      }),
    );
  });

  it("passes the denied read paths of the sandbox", async () => {
    const sandbox = { allowWrite: [], denyRead: ["/h/.ssh"], trackedPaths: async () => [], sharedFolder: "/shared" };

    const { fake } = await run({ stream: codexSample("plain") }, { sandbox });

    expect(fake.calls()[0].argv).toEqual(expectedCodexArgs({ model: "haiku", effort: "low", denyRead: ["/h/.ssh"] }));
  });

  it("sends the prompt on stdin", async () => {
    const { fake } = await run({ stream: codexSample("plain") }, { prompt: "the prompt text" });

    expect(fake.calls()[0].stdin).toBe("the prompt text");
  });

  it("does not refuse a run because of deniedCommands", async () => {
    const { outcome, fake } = await run({ stream: codexSample("plain") }, { deniedCommands: ["git push", "herdr"] });

    expect(outcome.kind).toBe("success");
    expect(fake.calls()).toHaveLength(1);
  });

  it("writes no file under CODEX_HOME", async () => {
    const codexHome = useTempDir("tasker-codex-home-");

    await run({ stream: codexSample("plain") }, { env: { ...useFakeCodexRun({}).env, CODEX_HOME: codexHome } });

    expect(readdirSync(codexHome)).toEqual([]);
  });

  it("gives the same outcome with an overageStop", async () => {
    const plain = await run({ stream: codexSample("plain") });
    const stopped = await run({ stream: codexSample("plain") }, { overageStop: {} });

    expect(stopped.outcome).toEqual(plain.outcome);
  });

  it("sets no sandboxCleanup, also with a sandbox", async () => {
    const sandbox = { allowWrite: [], denyRead: [], trackedPaths: async () => [], sharedFolder: "/shared" };

    const plain = await run({ stream: codexSample("plain") });
    const sandboxed = await run({ stream: codexSample("plain") }, { sandbox });

    expect(plain.outcome).not.toHaveProperty("sandboxCleanup");
    expect(sandboxed.outcome).not.toHaveProperty("sandboxCleanup");
  });
});

describe("createCodexProvider run: the stream", () => {
  it("does not stop when onEvent throws", async () => {
    const onEvent = vi.fn(() => {
      throw new Error("listener broke");
    });

    const { outcome } = await run({ stream: codexSample("plain") }, { onEvent });

    expect(outcome.kind).toBe("success");
    expect(onEvent).toHaveBeenCalledTimes(4);
  });

  it("gives success when a warning item comes before turn.completed", async () => {
    const warning: AssistantEvent = { type: "item.completed", item: { id: "w", type: "error", message: "warn" } };
    const stream = [codexSample("plain")[0], JSON.stringify(warning), ...codexSample("plain").slice(1)];

    const { outcome } = await run({ stream });

    expect(outcome.kind).toBe("success");
  });

  it("gives success and no denials for a command item whose output shows a sandbox block", async () => {
    const events = codexSampleEvents("command");
    const done = events[3].item as Record<string, unknown>;
    done.aggregated_output = "touch: cannot touch 'x': Read-only file system\n";
    done.exit_code = 1;

    const { outcome } = await run({ stream: events.map((event) => JSON.stringify(event)) });

    expect(outcome).toMatchObject({ kind: "success", permissionDenials: [] });
  });
});

describe("createCodexProvider run: the usage", () => {
  it("gives the whole total of a new session and writes the usage file", async () => {
    const { outcome, sessionDir } = await run({ stream: codexSample("plain") });

    expect(outcome.usage).toEqual(CODEX_PLAIN_USAGE);
    expect(readUsageTotal(sessionDir, TEST_SESSION_ID)).toEqual(CODEX_PLAIN_USAGE);
  });

  it("subtracts the stored total in a continued run", async () => {
    const setup = setUp({ stream: codexSample("resume") }, {}, THREAD_ID);
    writeUsageTotal(setup.sessionDir, TEST_SESSION_ID, CODEX_PLAIN_USAGE);

    const outcome = await codexProvider().run(setup.input);

    expect(outcome.usage).toEqual(CODEX_RESUME_USAGE);
  });

  it("counts a bad usage file as zero", async () => {
    const setup = setUp({ stream: codexSample("plain") }, {}, THREAD_ID);
    writeFileSync(codexUsagePath(setup.sessionDir, TEST_SESSION_ID), "not json");

    const outcome = await codexProvider().run(setup.input);

    expect(outcome.usage).toEqual(CODEX_PLAIN_USAGE);
  });

  it("gives unavailable with no turn.completed and leaves the usage file", async () => {
    const setup = setUp({ stream: codexSample("plain").slice(0, 3) }, {}, THREAD_ID);
    writeUsageTotal(setup.sessionDir, TEST_SESSION_ID, CODEX_PLAIN_USAGE);

    const outcome = await codexProvider().run(setup.input);

    expect(outcome.usage).toBe("unavailable");
    expect(readUsageTotal(setup.sessionDir, TEST_SESSION_ID)).toEqual(CODEX_PLAIN_USAGE);
    expect(existsSync(codexUsagePath(setup.sessionDir, TEST_SESSION_ID))).toBe(true);
  });
});

describe("createCodexProvider run: the execute role", () => {
  const REFUSAL = "the codex assistant cannot run the execute role in this version";
  const sandbox = { allowWrite: [], denyRead: [], trackedPaths: async () => [], sharedFolder: "/shared" };

  it("refuses access workspace-write before the spawn", async () => {
    const onSpawn = vi.fn();

    const { outcome, fake } = await run(
      { stream: codexSample("plain") },
      { access: "workspace-write", onSpawn, sandbox },
    );

    expect(outcome).toEqual({
      kind: "failure",
      sessionId: TEST_SESSION_ID,
      events: [],
      permissionDenials: [],
      usage: "unavailable",
      exitCode: null,
      signal: null,
      reason: REFUSAL,
    });
    expect(outcome).not.toHaveProperty("sandboxCleanup");
    expect(fake.calls()).toEqual([]);
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it("refuses the execute role before it looks for the thread id file", async () => {
    const { outcome, fake } = await run({ stream: codexSample("plain") }, { access: "workspace-write", resume: true });

    expect(failureOf(outcome).reason).toBe(REFUSAL);
    expect(fake.calls()).toEqual([]);
  });
});
