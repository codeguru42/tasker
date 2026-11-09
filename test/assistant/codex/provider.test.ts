import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCodexProvider } from "../../../src/assistant/codex/provider.js";
import type { AssistantEvent, AssistantProvider, RunInput, RunOutcome } from "../../../src/assistant/provider.js";
import { assistantSchemaPath } from "../../../src/store/layout.js";
import { parseConfig } from "../../../src/config/schema.js";
import { validConfig } from "../../helpers/config.js";
import {
  TEST_SESSION_ID,
  failureOutcomeOf,
  runInput,
  sandboxLimits,
  type FakeClaude,
  type FakeClaudeControl,
} from "../../helpers/fake-claude.js";
import {
  CODEX_PLAIN_USAGE,
  CODEX_RESUME_USAGE,
  CODEX_THREAD_ID,
  codexSample,
  codexSampleEvents,
  expectedCodexArgs,
  useFakeCodexRun,
} from "../../helpers/fake-codex.js";
import { useTempDir, useTempFile } from "../../helpers/temp.js";

function makeAssistantSchemaPath(sessionDir: string, sessionId: string): string {
  return assistantSchemaPath(sessionDir, sessionId);
}

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

const NO_THREAD = `the codex session ${TEST_SESSION_ID} has no thread id, so the run cannot continue it`;

interface Setup {
  fake: FakeClaude;
  sessionDir: string;
  input: RunInput;
}

// A fake codex, a temp cwd and a temp sessionDir. A continued run gets threadId as its providerSessionId.
function setUp(control: FakeClaudeControl, overrides: Partial<RunInput> = {}, threadId?: string): Setup {
  const fake = useFakeCodexRun(control);
  const sessionDir = useTempDir("tasker-codex-sessions-");
  const input = runInput({
    cwd: useTempDir("tasker-codex-cwd-"),
    env: fake.env,
    sessionDir,
    ...overrides,
    ...(threadId === undefined ? {} : { resume: true, providerSessionId: threadId }),
  });
  return { fake, sessionDir, input };
}

// The herdr folder that the socket deny names for the HOME of the fake.
function herdrFolder(fake: FakeClaude): string {
  return join(fake.env.HOME, ".config", "herdr");
}

async function run(control: FakeClaudeControl, overrides: Partial<RunInput> = {}, threadId?: string) {
  const setup = setUp(control, overrides, threadId);
  const outcome = await codexProvider().run(setup.input);
  return { ...setup, outcome };
}

describe("createCodexProvider runtime path errors", () => {
  it("fails before spawn when XDG_RUNTIME_DIR has an ELOOP", async () => {
    const dir = useTempDir("tasker-runtime-loop-");
    const loop = join(dir, "loop");
    symlinkSync(loop, loop);
    const onSpawn = vi.fn();
    const setup = setUp({ stream: codexSample("plain") }, { onSpawn });
    const outcome = await codexProvider().run({
      ...setup.input,
      env: { ...setup.input.env, XDG_RUNTIME_DIR: loop },
    });
    expect(failureOutcomeOf(outcome)).toMatchObject({ kind: "failure", exitCode: null, signal: null });
    expect(setup.fake.calls()).toEqual([]);
    expect(onSpawn).not.toHaveBeenCalled();
  });
});

describe("createCodexProvider run: the outcome rows", () => {
  it("fails when codex is not on PATH", async () => {
    const setup = setUp({ stream: codexSample("plain") });
    const emptyBin = join(useTempDir("tasker-empty-bin-"), "bin");
    mkdirSync(emptyBin);

    const outcome = await codexProvider().run({ ...setup.input, env: { PATH: emptyBin, HOME: emptyBin } });

    expect(failureOutcomeOf(outcome)).toMatchObject({
      reason: "codex is not installed or not on PATH",
      exitCode: null,
      signal: null,
    });
    expect(setup.fake.calls()).toEqual([]);
  });

  it("fails with the start error when the cwd does not exist", async () => {
    const { outcome, fake } = await run({ stream: codexSample("plain") }, { cwd: "/tasker-no-such-folder" });

    expect(failureOutcomeOf(outcome).reason).not.toBe("codex is not installed or not on PATH");
    expect(failureOutcomeOf(outcome).exitCode).toBeNull();
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

    expect(failureOutcomeOf(outcome)).toMatchObject({
      reason: "codex was killed by SIGKILL",
      exitCode: null,
      signal: "SIGKILL",
    });
  });

  it("gives the message of the failure event, not the exit code", async () => {
    const { outcome } = await run({ stream: codexSample("turn-failed"), exitCode: 1 });

    const failed = codexSampleEvents("turn-failed").find((event) => event.type === "turn.failed")!;
    expect(failureOutcomeOf(outcome)).toMatchObject({
      reason: (failed.error as { message: string }).message,
      exitCode: 1,
    });
  });

  it("fails with the exit code and the end of stderr", async () => {
    const { outcome } = await run({ stream: codexSample("plain"), exitCode: 3, stderr: "boom\n" });

    expect(failureOutcomeOf(outcome)).toMatchObject({ reason: "codex exited 3: boom", exitCode: 3, signal: null });
  });

  it("fails when the stream has no turn.completed", async () => {
    const { outcome } = await run({ stream: codexSample("plain").slice(0, 3) });

    expect(failureOutcomeOf(outcome).reason).toBe("the assistant ended with no result");
  });

  it("fails when a schema is set and the answer is not JSON", async () => {
    const { outcome } = await run({ stream: codexSample("plain") }, { jsonSchema: { type: "object" } });

    expect(failureOutcomeOf(outcome).reason).toBe("the assistant gave no structured answer");
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
    expect(JSON.parse(readFileSync(makeAssistantSchemaPath(sessionDir, TEST_SESSION_ID), "utf8"))).toEqual(jsonSchema);
  });

  it("fails with no call when the schema file cannot be written", async () => {
    const { outcome, fake } = await run(
      { stream: codexSample("json-schema") },
      { jsonSchema: { type: "object" }, sessionDir: join(useTempDir("tasker-codex-none-"), "missing") },
    );

    expect(failureOutcomeOf(outcome).exitCode).toBeNull();
    expect(fake.calls()).toEqual([]);
  });
});

describe("createCodexProvider run: the thread id", () => {
  it("gives the thread id to onProviderSessionId once, at thread.started", async () => {
    const onProviderSessionId = vi.fn();

    await run({ stream: codexSample("plain") }, { onProviderSessionId });

    expect(onProviderSessionId.mock.calls).toEqual([[CODEX_THREAD_ID]]);
  });

  it("passes the stored id to a continued run", async () => {
    const { fake } = await run({ stream: codexSample("plain") }, {}, "T-stored");

    expect(fake.calls()[0].argv).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", denyRead: [herdrFolder(fake)], threadId: "T-stored" }),
    );
  });

  it("fails with no call when a continued run has no providerSessionId", async () => {
    const onProviderSessionId = vi.fn();

    const { outcome, fake } = await run({ stream: codexSample("plain") }, { resume: true, onProviderSessionId });

    expect(failureOutcomeOf(outcome).reason).toBe(NO_THREAD);
    expect(fake.calls()).toEqual([]);
    expect(onProviderSessionId).not.toHaveBeenCalled();
  });

  it("calls no callback after a killed run before thread.started, and the next run starts no child", async () => {
    const onProviderSessionId = vi.fn();
    const first = await run({ stream: [], killWith: "SIGKILL" }, { onProviderSessionId });

    expect(onProviderSessionId).not.toHaveBeenCalled();
    const next = await codexProvider().run({ ...first.input, resume: true });
    expect(failureOutcomeOf(next).reason).toBe(NO_THREAD);
    expect(onProviderSessionId).not.toHaveBeenCalled();
    expect(first.fake.calls()).toHaveLength(1);
  });

  it("gives the session id and never the thread id in the outcome", async () => {
    for (const control of [{ stream: codexSample("plain") }, { stream: codexSample("plain"), exitCode: 3 }]) {
      const { outcome } = await run(control);

      expect(outcome.sessionId).toBe(TEST_SESSION_ID);
      expect(JSON.stringify({ ...outcome, events: [] })).not.toContain(CODEX_THREAD_ID);
    }
  });

  it("gives its normal success with a sessionDir that does not exist, and a later continued run starts", async () => {
    const sessionDir = join(useTempDir("tasker-codex-none-"), "missing");
    const onProviderSessionId = vi.fn();

    const first = await run({ stream: codexSample("plain") }, { sessionDir, onProviderSessionId });
    expect(onProviderSessionId.mock.calls).toEqual([[CODEX_THREAD_ID]]);
    const second = await codexProvider().run({ ...first.input, resume: true, providerSessionId: CODEX_THREAD_ID });

    expect(first.outcome.kind).toBe("success");
    expect(second.kind).toBe("success");
    expect(first.fake.calls()).toHaveLength(2);
  });

  it("gives the same outcome kind when onProviderSessionId throws", async () => {
    const { outcome } = await run(
      { stream: codexSample("plain") },
      {
        onProviderSessionId: () => {
          throw new Error("write failed");
        },
      },
    );

    expect(outcome.kind).toBe("success");
  });
});

describe("createCodexProvider run: the arguments and the env", () => {
  it("passes the arguments of a new session", async () => {
    const { fake } = await run({ stream: codexSample("plain") });

    expect(fake.calls()[0].argv).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", denyRead: [herdrFolder(fake)] }),
    );
  });

  it("passes the arguments of a new session with a schema", async () => {
    const { fake, sessionDir } = await run({ stream: codexSample("plain") }, { jsonSchema: { type: "object" } });

    expect(fake.calls()[0].argv).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        denyRead: [herdrFolder(fake)],
        schemaPath: makeAssistantSchemaPath(sessionDir, TEST_SESSION_ID),
      }),
    );
  });

  it("passes the denied read paths of the sandbox", async () => {
    const sandbox = sandboxLimits({ denyRead: ["/h/.ssh"] });

    const { fake } = await run({ stream: codexSample("plain") }, { sandbox });

    expect(fake.calls()[0].argv).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", denyRead: ["/h/.ssh", herdrFolder(fake)] }),
    );
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
    const sandbox = sandboxLimits();

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
  it("gives the whole total of a new session and gives it to onUsageTotal", async () => {
    const onUsageTotal = vi.fn();

    const { outcome } = await run({ stream: codexSample("plain") }, { onUsageTotal });

    expect(outcome.usage).toEqual(CODEX_PLAIN_USAGE);
    expect(onUsageTotal.mock.calls).toEqual([[CODEX_PLAIN_USAGE]]);
  });

  it("subtracts the stored total in a continued run", async () => {
    const { outcome } = await run(
      { stream: codexSample("resume") },
      { usageTotal: CODEX_PLAIN_USAGE },
      CODEX_THREAD_ID,
    );

    expect(outcome.usage).toEqual(CODEX_RESUME_USAGE);
  });

  it("counts a missing stored total as zero", async () => {
    const { outcome } = await run({ stream: codexSample("plain") }, {}, CODEX_THREAD_ID);

    expect(outcome.usage).toEqual(CODEX_PLAIN_USAGE);
  });

  it("gives unavailable with no turn.completed and calls no onUsageTotal", async () => {
    const onUsageTotal = vi.fn();

    const { outcome } = await run(
      { stream: codexSample("plain").slice(0, 3) },
      { usageTotal: CODEX_PLAIN_USAGE, onUsageTotal },
      CODEX_THREAD_ID,
    );

    expect(outcome.usage).toBe("unavailable");
    expect(onUsageTotal).not.toHaveBeenCalled();
  });

  it("gives the same outcome kind and usage when onUsageTotal throws", async () => {
    const { outcome } = await run(
      { stream: codexSample("plain") },
      {
        onUsageTotal: () => {
          throw new Error("write failed");
        },
      },
    );

    expect(outcome.kind).toBe("success");
    expect(outcome.usage).toEqual(CODEX_PLAIN_USAGE);
  });
});

describe("createCodexProvider run: the execute role", () => {
  async function executeRun(control: FakeClaudeControl, overrides: Partial<RunInput> = {}, threadId?: string) {
    const hookScript = useTempFile("tasker-codex-hook-", "edit-hook-main.js", "");
    const setup = setUp(
      control,
      { access: "workspace-write", sandbox: sandboxLimits({ allowWrite: ["/c/objects"] }), ...overrides },
      threadId,
    );
    const denied = [`${setup.input.cwd}/.git`, `${setup.input.cwd}/.git/**`];
    const outcome = await createCodexProvider({ hookScript }).run({ ...setup.input, deniedEditPaths: denied });
    const cwd = setup.input.cwd;
    const hookCommand = `'${process.execPath}' '${hookScript}' '${cwd}' '${denied[0]}' '${denied[1]}'`;
    return { ...setup, hookScript, hookCommand, cwd, outcome };
  }

  const write = (cwd: string) => [realpathSync(cwd), "/tmp", "/c/objects"];

  it("runs workspace-write and passes the expected arguments", async () => {
    const { fake, cwd, hookCommand, outcome } = await executeRun({ stream: codexSample("plain") });

    expect(outcome.kind).toBe("success");
    expect(fake.calls()[0].argv).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: write(cwd),
        denyRead: [herdrFolder(fake)],
        hookCommand,
      }),
    );
  });

  it("continues a workspace-write session with the thread id and the same hook", async () => {
    const { fake, cwd, hookCommand } = await executeRun({ stream: codexSample("resume") }, {}, CODEX_THREAD_ID);

    expect(fake.calls()[0].argv).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: write(cwd),
        denyRead: [herdrFolder(fake)],
        hookCommand,
        threadId: CODEX_THREAD_ID,
      }),
    );
  });

  it.each([false, true])("denies protected skill paths without direct write keys on a %s run", async (resume) => {
    const { fake, cwd } = await executeRun(
      { stream: resume ? codexSample("resume") : codexSample("plain") },
      {},
      resume ? CODEX_THREAD_ID : undefined,
    );
    const profile = fake.calls()[0].argv.find((arg) => arg.startsWith("permissions.tasker.filesystem="));

    expect(profile).toContain(`${JSON.stringify(join(realpathSync(cwd), ".agents"))}="deny"`);
    expect(profile).toContain(`${JSON.stringify(join(realpathSync(cwd), ".codex"))}="deny"`);
    expect(profile).not.toContain(`${JSON.stringify(join(realpathSync(cwd), ".agents"))}="write"`);
    expect(profile).not.toContain(`${JSON.stringify(join(realpathSync(cwd), ".codex"))}="write"`);
  });

  it("passes the prompt on stdin and gives success", async () => {
    const { fake, outcome } = await executeRun({ stream: codexSample("plain") }, { prompt: "write it" });

    expect(fake.calls()[0].stdin).toBe("write it");
    expect(outcome.kind).toBe("success");
  });

  it("writes no file under CODEX_HOME", async () => {
    const codexHome = useTempDir("tasker-codex-home-");

    await executeRun({ stream: codexSample("plain") }, { env: { ...useFakeCodexRun({}).env, CODEX_HOME: codexHome } });

    expect(readdirSync(codexHome)).toEqual([]);
  });

  it("gives permissionDenials of []", async () => {
    const { outcome } = await executeRun({ stream: codexSample("hook-flag") });

    expect(outcome.permissionDenials).toEqual([]);
  });

  it("fails with no call and no onSpawn when the hook script is missing", async () => {
    const onSpawn = vi.fn();
    const hookScript = join(useTempDir("tasker-codex-hook-"), "missing.js");
    const setup = setUp(
      { stream: codexSample("plain") },
      { access: "workspace-write", sandbox: sandboxLimits(), onSpawn },
    );

    const outcome = await createCodexProvider({ hookScript }).run(setup.input);

    expect(failureOutcomeOf(outcome)).toMatchObject({
      reason: `the codex edit hook is missing: ${hookScript}`,
      exitCode: null,
      signal: null,
    });
    expect(setup.fake.calls()).toEqual([]);
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it("gives success for the stream of the hook trust flag", async () => {
    const { outcome } = await executeRun({ stream: codexSample("hook-flag") });

    expect(outcome.kind).toBe("success");
  });

  describe("the cleanup of the empty folders", () => {
    const NAMES = [".agents", ".aws", ".codex"];

    // A program for the exec field of the fake. It runs in the cwd of the fake, and the source is JavaScript.
    const node = (source: string) => [process.execPath, "-e", source];
    const makeFolders =
      "for (const n of ['.agents', '.aws', '.codex']) require('fs').mkdirSync(n, { recursive: true });";

    it("removes the folders that the fake made, and gives them in sandboxCleanup.removed", async () => {
      const { outcome, cwd } = await executeRun({ stream: codexSample("plain"), exec: node(makeFolders) });

      expect(outcome).toMatchObject({ kind: "success", sandboxCleanup: { removed: NAMES } });
      expect(readdirSync(cwd)).toEqual([]);
    });

    it("keeps a folder that existed before", async () => {
      const cwd = useTempDir("tasker-codex-cwd-");
      mkdirSync(join(cwd, ".aws"));

      const { outcome } = await executeRun({ stream: codexSample("plain"), exec: node(makeFolders) }, { cwd });

      expect(outcome).toMatchObject({ sandboxCleanup: { removed: [".agents", ".codex"] } });
      expect(existsSync(join(cwd, ".aws"))).toBe(true);
    });

    it("keeps a folder that is not empty", async () => {
      const exec = node(`${makeFolders} require('fs').writeFileSync('.codex/keep', '');`);

      const { outcome, cwd } = await executeRun({ stream: codexSample("plain"), exec });

      expect(outcome).toMatchObject({ sandboxCleanup: { removed: [".agents", ".aws"] } });
      expect(existsSync(join(cwd, ".codex", "keep"))).toBe(true);
    });

    it("keeps a preexisting exact Codex skills link during placeholder cleanup", async () => {
      const cwd = useTempDir("tasker-codex-cwd-");
      mkdirSync(join(cwd, ".agents", "skills"), { recursive: true });
      mkdirSync(join(cwd, ".codex"));
      symlinkSync("../.agents/skills", join(cwd, ".codex", "skills"));

      const { outcome } = await executeRun({ stream: codexSample("plain"), exec: node(makeFolders) }, { cwd });

      expect(outcome).toMatchObject({ sandboxCleanup: { removed: [".aws"] } });
      expect(readlinkSync(join(cwd, ".codex", "skills"))).toBe("../.agents/skills");
    });

    it.skipIf(process.getuid?.() === 0)("gives the error of a failed rmdir, and the kind stays success", async () => {
      const cwd = useTempDir("tasker-codex-cwd-");
      const exec = node("require('fs').mkdirSync('.aws'); require('fs').chmodSync(process.cwd(), 0o555);");

      try {
        const { outcome } = await executeRun({ stream: codexSample("plain"), exec }, { cwd });

        expect(outcome).toMatchObject({
          kind: "success",
          sandboxCleanup: { error: "cannot remove the sandbox placeholders: EACCES" },
        });
      } finally {
        chmodSync(cwd, 0o755);
      }
    });

    it("runs the cleanup after a killed run", async () => {
      const { outcome } = await executeRun({ stream: [], killWith: "SIGKILL", exec: node(makeFolders) });

      expect(failureOutcomeOf(outcome).sandboxCleanup).toEqual({ removed: NAMES });
    });

    it.skipIf(process.getuid?.() === 0)(
      "gives a failure outcome with no spawn when the cwd cannot be searched",
      async () => {
        const parent = useTempDir("tasker-codex-parent-");
        const cwd = join(parent, "cwd");
        mkdirSync(cwd);
        const onSpawn = vi.fn();
        chmodSync(parent, 0o000);

        try {
          const { outcome, fake } = await executeRun({ stream: codexSample("plain") }, { cwd, onSpawn });

          expect(failureOutcomeOf(outcome)).toMatchObject({ exitCode: null, signal: null });
          expect(outcome).not.toHaveProperty("sandboxCleanup");
          expect(fake.calls()).toEqual([]);
          expect(onSpawn).not.toHaveBeenCalled();
        } finally {
          chmodSync(parent, 0o755);
        }
      },
    );

    it("sets no sandboxCleanup when the run was refused", async () => {
      const hookScript = join(useTempDir("tasker-codex-hook-"), "missing.js");
      const setup = setUp({ stream: codexSample("plain") }, { access: "workspace-write", sandbox: sandboxLimits() });

      const outcome = await createCodexProvider({ hookScript }).run(setup.input);

      expect(outcome).not.toHaveProperty("sandboxCleanup");
    });
  });
});
