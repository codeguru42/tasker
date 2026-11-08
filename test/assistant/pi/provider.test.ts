import * as os from "node:os";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assistantSchemaPath } from "../../../src/store/layout.js";
import { guardLimitsPath } from "../../../src/store/layout.js";
import { PI_READ_TOOL_NAMES, piArgs } from "../../../src/assistant/pi/args.js";
import { PI_ANSWER_TOOL_NAME } from "../../../src/assistant/pi/answer-tool.js";
import type { PiFiles } from "../../../src/assistant/pi/args.js";
import { createPiProvider as fromCreatePiProvider } from "../../../src/assistant/pi/provider.js";
import type { RunInput, RunOutcome } from "../../../src/assistant/provider.js";
import { planAnswerJsonSchema } from "../../../src/plan/answer.js";
import { reviewAnswerJsonSchema } from "../../../src/review/answer.js";
import { failureOutcomeOf, runInput, TEST_SESSION_ID } from "../../helpers/fake-claude.js";
import { useFakePi } from "../../helpers/fake-pi.js";
import { useTempDir } from "../../helpers/temp.js";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, platform: vi.fn(() => "linux") };
});

const TRUSTED = ["builtin:llama.cpp", "builtin:codemode", "builtin:tool-search"];
const measures = JSON.parse(
  readFileSync(new URL("../../fixtures/pi-streams/measures.json", import.meta.url), "utf8"),
) as Record<string, { sessionFile: string; stdout: Record<string, unknown>[]; session: unknown[] }>;

function callPi(input: RunInput, files: PiFiles): Promise<RunOutcome> {
  return fromCreatePiProvider(files).run(input);
}

function validInput(overrides: Partial<RunInput> = {}): RunInput {
  return {
    ...runInput(),
    sessionId: TEST_SESSION_ID,
    env: { HOME: "/home/user" },
    cwd: useTempDir("tasker-pi-worktree-"),
    sessionDir: useTempDir("tasker-pi-provider-session-"),
    trustedExtensions: TRUSTED,
    model: "openrouter/openrouter/auto",
    effort: "low",
    checkAnswer: () => ({ ok: true }),
    ...overrides,
  };
}

function expectedArgs(input: RunInput, files: PiFiles, withSchema = input.jsonSchema !== undefined): string[] {
  return piArgs(
    input,
    files,
    guardLimitsPath(input.sessionDir, input.sessionId),
    withSchema ? assistantSchemaPath(input.sessionDir, input.sessionId) : undefined,
  );
}

function expectOneCall(fake: ReturnType<typeof useFakePi>, input: RunInput, args: string[]): void {
  const calls = fake.calls();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ args, stdin: input.prompt });
}

function makeFiles(): PiFiles {
  const dir = useTempDir("tasker-pi-provider-files-");
  const files = { guardFile: join(dir, "guard.js"), answerFile: join(dir, "answer.js") };
  writeFileSync(files.guardFile, "export default function guard() {}\n");
  writeFileSync(files.answerFile, "export default function answer() {}\n");
  return files;
}

function refusalOf(outcome: RunOutcome) {
  return failureOutcomeOf(outcome);
}

function expectReadOnlyTools(args: string[]) {
  const tools = args[args.indexOf("--tools") + 1];
  expect(tools).toBe("read,grep,find,ls,submit_answer");
  expect(tools).not.toContain("bash");
  expect(tools).not.toContain("edit");
  expect(tools).not.toContain("write");
}

describe("createPiProvider pre-spawn refusals", () => {
  it("refuses a JSON Schema without a caller check before spawn", async () => {
    const fake = useFakePi([]);
    const input = validInput({ jsonSchema: planAnswerJsonSchema(), checkAnswer: undefined });
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, makeFiles());

    rmSync(`${fake.logPath}.unanswered`, { force: true });
    expect(fake.calls()).toEqual([]);
    expect(outcome).toMatchObject({
      kind: "failure",
      reason: "a run with a JSON Schema needs RunInput.checkAnswer",
      exitCode: null,
      signal: null,
      events: [],
      permissionDenials: [],
    });
  });

  it("refuses a non-Linux host before execute and child environment checks", async () => {
    vi.mocked(os.platform).mockReturnValue("darwin");
    const onSpawn = vi.fn();
    const outcome = await callPi(
      validInput({ access: "workspace-write", env: { HOME: "relative" }, onSpawn }),
      makeFiles(),
    );

    expect(refusalOf(outcome).reason).toBe("the pi assistant runs only on Linux; this host is darwin");
    expect(onSpawn).not.toHaveBeenCalled();
    vi.mocked(os.platform).mockReturnValue("linux");
  });

  it("refuses execute access before checking the child environment", async () => {
    const onSpawn = vi.fn();
    const outcome = await callPi(
      validInput({ access: "workspace-write", env: { HOME: "relative" }, onSpawn }),
      makeFiles(),
    );

    expect(refusalOf(outcome).reason).toBe("the pi assistant cannot run the execute role in this version");
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it.each([
    [
      "relative TASKER_PI_CODING_AGENT_DIR",
      { HOME: "/home/user", TASKER_PI_CODING_AGENT_DIR: "rel/x" },
      "TASKER_PI_CODING_AGENT_DIR must be an absolute path, got rel/x",
    ],
    ["relative HOME", { HOME: "rel/h" }, "HOME must be an absolute path, got rel/h"],
    ["missing HOME", {}, "tasker cannot find the agent folder of pi, because HOME is not set"],
  ])("refuses %s before extension checks", async (_label, env, reason) => {
    const outcome = await callPi(validInput({ env }), makeFiles());

    expect(refusalOf(outcome).reason).toBe(reason);
  });

  it("refuses an extension precheck failure before checking a resume file", async () => {
    const sessionDir = useTempDir("tasker-pi-no-session-");
    const cwd = useTempDir("tasker-pi-denied-worktree-");
    const outcome = await callPi(
      validInput({
        env: { HOME: "/home/user", TASKER_PI_CODING_AGENT_DIR: join(cwd, ".pi-agent") },
        resume: true,
        sessionDir,
        cwd,
      }),
      makeFiles(),
    );

    expect(refusalOf(outcome).reason).toBe(`the agent folder of pi is in the worktree: ${join(cwd, ".pi-agent")}`);
  });

  it("refuses a continued session with no session file", async () => {
    const input = validInput({ resume: true });
    const files = makeFiles();
    files.guardFile = join(useTempDir("tasker-pi-missing-extension-"), "guard.js");
    const outcome = await callPi(input, files);

    expect(refusalOf(outcome).reason).toBe(
      `the pi session ${input.sessionId} has no session file, so the run cannot continue it`,
    );
  });

  it("does not treat a matching directory as a continued session file", async () => {
    const input = validInput({ resume: true });
    const files = makeFiles();
    mkdirSync(join(input.sessionDir, `x_${input.sessionId}.jsonl`));
    const fake = useFakePi([]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(refusalOf(outcome).reason).toBe(
      `the pi session ${input.sessionId} has no session file, so the run cannot continue it`,
    );
    expect(fake.calls()).toEqual([]);
  });

  it.each(["guardFile", "answerFile"] as const)("refuses when the injected %s is not a file", async (key) => {
    const files = makeFiles();
    files[key] = join(useTempDir("tasker-pi-missing-file-"), key);
    const outcome = await callPi(validInput(), files);

    expect(refusalOf(outcome).reason).toContain(files[key]);
  });
});

describe("createPiProvider runs", () => {
  it.each([true, false])("keeps guard tools aligned with --tools (schema: %s)", async (withSchema) => {
    const input = validInput(withSchema ? { jsonSchema: reviewAnswerJsonSchema() } : {});
    const files = makeFiles();
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      [...PI_READ_TOOL_NAMES, ...(withSchema ? [PI_ANSWER_TOOL_NAME] : [])].join(","),
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
      ...(withSchema
        ? ["-e", files.answerFile, "--tasker-answer-schema", assistantSchemaPath(input.sessionDir, input.sessionId)]
        : []),
    ];
    const fixture = withSchema ? measures.valid : measures.text;
    const fake = useFakePi([{ args, stream: fixture.stdout, session: fixture.session }]);
    input.env = { ...input.env, ...fake.env };

    await callPi(input, files);

    const limits = JSON.parse(readFileSync(guardLimitsPath(input.sessionDir, input.sessionId), "utf8")) as {
      tools: { name: string }[];
    };
    const loggedTools = fake.calls()[0].args[fake.calls()[0].args.indexOf("--tools") + 1];
    expect(limits.tools.map((tool) => tool.name)).toEqual(loggedTools.split(","));
    if (withSchema) {
      expect(limits.tools.at(-1)?.name).toBe(PI_ANSWER_TOOL_NAME);
      expect(loggedTools.split(",").at(-1)).toBe(PI_ANSWER_TOOL_NAME);
    }
  });

  it("starts a new read-only run with literal arguments, writes limits and schema, and reports events and transcript", async () => {
    const sessionDir = useTempDir("tasker-pi-run-");
    const input = validInput({
      sessionDir,
      prompt: "  lead\n\nmid  line\ntail \n\n",
      jsonSchema: reviewAnswerJsonSchema(),
      onEvent: vi.fn(),
      onSpawn: vi.fn(),
      sandbox: {
        allowWrite: [],
        denyRead: ["/private/read-deny"],
        trackedPaths: async () => [],
        sharedFolder: "/shared",
      },
      env: {
        HOME: "/home/user",
        ANTHROPIC_API_KEY: "secret-anthropic",
        OPENROUTER_API_KEY: "secret-openrouter",
        OPENAI_API_KEY: "secret-openai",
        GITHUB_TOKEN: "secret-github",
        GH_TOKEN: "secret-gh",
        TASKER_PRIVATE_VALUE: "secret-tasker",
      },
    });
    const files = makeFiles();
    const schemaPath = assistantSchemaPath(sessionDir, input.sessionId);
    const limitsPath = guardLimitsPath(sessionDir, input.sessionId);
    const matchingSessionFile = measures.valid.sessionFile.replace(/_[^_]+\.jsonl$/u, `_${input.sessionId}.jsonl`);
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      sessionDir,
      "--tools",
      "read,grep,find,ls,submit_answer",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      limitsPath,
      "-e",
      files.answerFile,
      "--tasker-answer-schema",
      schemaPath,
    ];
    const fake = useFakePi(
      [
        {
          args,
          stream: measures.valid.stdout,
          session: measures.valid.session,
          sessionFile: matchingSessionFile,
        },
      ],
      ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "OPENAI_API_KEY", "TASKER_PRIVATE_VALUE"],
    );
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("success");
    expect(outcome).toMatchObject({ structuredOutput: { findings: [] }, usage: "unavailable", permissionDenials: [] });
    expect(outcome.transcriptPath).toBe(join(sessionDir, matchingSessionFile));
    expect(existsSync(outcome.transcriptPath!)).toBe(true);
    expect(JSON.parse(readFileSync(schemaPath, "utf8"))).toEqual(reviewAnswerJsonSchema());
    expectReadOnlyTools(args);
    expect(JSON.parse(readFileSync(limitsPath, "utf8")).denyRead).toEqual(["/private/read-deny"]);
    expect(JSON.parse(readFileSync(limitsPath, "utf8")).tools).toContainEqual({
      name: "submit_answer",
      path: files.answerFile,
      source: "cli",
    });
    expect(fake.calls()).toEqual([
      {
        args,
        stdin: input.prompt,
        envNames: expect.arrayContaining(["PI_CODING_AGENT_DIR"]),
        env: {
          OPENROUTER_API_KEY: undefined,
          ANTHROPIC_API_KEY: undefined,
          GITHUB_TOKEN: undefined,
          GH_TOKEN: undefined,
          OPENAI_API_KEY: undefined,
          TASKER_PRIVATE_VALUE: undefined,
        },
      },
    ]);
    expect(fake.calls()[0].envNames).not.toEqual(
      expect.arrayContaining(["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GH_TOKEN"]),
    );
    expect(input.onEvent).toHaveBeenCalledTimes(measures.valid.stdout.length);
    expect(input.onSpawn).toHaveBeenCalledTimes(1);
  });

  it("runs without the answer tool for a continued session", async () => {
    const sessionDir = useTempDir("tasker-pi-resume-");
    const input = validInput({ sessionDir, resume: true });
    const files = makeFiles();
    const priorSession = join(sessionDir, `prior_${input.sessionId}.jsonl`);
    writeFileSync(priorSession, "old session\n");
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session",
      input.sessionId,
      "--session-dir",
      sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(sessionDir, input.sessionId),
    ];
    const fake = useFakePi([{ args, stream: measures.text.stdout, session: measures.text.session }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("success");
    expect(fake.calls()[0].args).toEqual(args);
    expect(JSON.parse(readFileSync(guardLimitsPath(sessionDir, input.sessionId), "utf8")).denyRead).toEqual([]);
  });

  it("does not report an unrelated new JSONL file as the transcript", async () => {
    const input = validInput();
    const files = makeFiles();
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
    ];
    const fake = useFakePi([
      {
        args,
        stream: measures.text.stdout,
        session: measures.text.session,
        sessionFile: "2026-01-01T00-00-00-000Z_unrelated.jsonl",
      },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("success");
    expect(outcome.transcriptPath).toBeUndefined();
  });

  it("passes a large prompt and a U+2028 event line without splitting or changing them", async () => {
    const input = validInput({ prompt: `  ${"x".repeat(4 * 1024 * 1024)}\n\u2028 tail  ` });
    const files = makeFiles();
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
    ];
    const event = {
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "before\u2028after" }] },
    };
    const fake = useFakePi([{ args, stream: [event, { type: "agent_end" }] }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(fake.calls()[0].stdin).toBe(input.prompt);
    expect(outcome.events).toContainEqual(event);
  });

  it("uses pi's trimmed prompt from the stream as the answer context", async () => {
    const input = validInput({ prompt: "  lead\n\nmid  line\ntail \n\n" });
    const files = makeFiles();
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
    ];
    const stream = [
      { type: "message_end", message: { role: "user", content: [{ type: "text", text: "lead\n\nmid  line\ntail" }] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: '{"answer":"ok"}' }] } },
      { type: "agent_end" },
    ];
    const fake = useFakePi([{ args, stream }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("success");
    expect(outcome.events[0]).toEqual(stream[0]);
  });
});

describe("createPiProvider outcomes", () => {
  it("reports a missing program", async () => {
    const input = validInput({ env: { HOME: "/home/user", PATH: useTempDir("tasker-empty-pi-") } });
    const outcome = await callPi(input, makeFiles());

    expect(refusalOf(outcome)).toMatchObject({ reason: "pi is not installed or not on PATH", exitCode: null });
  });

  it("reports the error when the child cannot start", async () => {
    const files = makeFiles();
    const input = validInput({ cwd: "/missing/tasker/worktree" });
    const fake = useFakePi([]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(refusalOf(outcome).reason).toContain("does not exist");
    expect(fake.calls()).toEqual([]);
  });

  it.each(["SIGINT", "SIGTERM"] as const)("returns interrupted when tasker passes %s", async (signal) => {
    const files = makeFiles();
    const input = validInput({ onSpawn: () => process.kill(process.pid, signal) });
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
    ];
    const fake = useFakePi([{ args, stream: [{ type: "agent_end" }], delaySeconds: 0.2 }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome).toMatchObject({ kind: "interrupted", signal });
  });

  it("returns timeout at the deadline", { timeout: 15_000 }, async () => {
    const files = makeFiles();
    const input = validInput({ timeoutMs: 50 });
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
    ];
    const fake = useFakePi([{ args, delaySeconds: 0.4 }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("timeout");
  });

  it("reports when pi is killed by a signal", async () => {
    const files = makeFiles();
    const input = validInput();
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
    ];
    const fake = useFakePi([{ args, killWith: "KILL", stderr: "killed\n" }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(refusalOf(outcome)).toMatchObject({ reason: "pi was killed by SIGKILL: killed", signal: "SIGKILL" });
  });

  it.each([
    ["error", { stopReason: "error", errorMessage: "scripted failure" }, "scripted failure"],
    ["aborted", { stopReason: "aborted" }, "pi ended its turn with aborted"],
  ])("reports an assistant %s turn", async (_label, assistantFields, reason) => {
    const files = makeFiles();
    const input = validInput();
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
    ];
    const fake = useFakePi([
      {
        args,
        stream: [
          { type: "message_end", message: { role: "assistant", content: [], ...assistantFields } },
          { type: "agent_end" },
        ],
      },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(refusalOf(outcome).reason).toBe(reason);
  });

  it("reports nonzero exit with the stderr tail", async () => {
    const files = makeFiles();
    const input = validInput();
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
    ];
    const fake = useFakePi([{ args, exitCode: 3, stderr: "broken\n" }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(refusalOf(outcome)).toMatchObject({ reason: "pi exited 3: broken", exitCode: 3 });
  });

  it("reports a run with no final assistant message", async () => {
    const files = makeFiles();
    const input = validInput();
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
    ];
    const fake = useFakePi([
      { args, stream: [{ type: "message_end", message: { role: "user", content: [] } }, { type: "agent_end" }] },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(refusalOf(outcome).reason).toBe("the assistant ended with no result");
  });

  it("reports missing structured output when a schema has no answer", async () => {
    const files = makeFiles();
    const input = validInput({ jsonSchema: planAnswerJsonSchema() });
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls,submit_answer",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
      "-e",
      files.answerFile,
      "--tasker-answer-schema",
      assistantSchemaPath(input.sessionDir, input.sessionId),
    ];
    const fake = useFakePi([{ args, stream: measures.text.stdout }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expectOneCall(fake, input, args);
    expect(refusalOf(outcome).reason).toBe(
      "the assistant gave no structured answer:\n  - no accepted call of submit_answer and no JSON object in the final text",
    );
    expectReadOnlyTools(args);
  });

  it("uses the final text when the accepted call fails the caller check", async () => {
    const input = validInput({ jsonSchema: reviewAnswerJsonSchema() });
    const files = makeFiles();
    const args = expectedArgs(input, files);
    const events = [
      ...measures.valid.stdout,
      {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: '{"source":"final text"}' }] },
      },
    ];
    input.checkAnswer = (output) =>
      typeof output === "object" && output !== null && "source" in output
        ? { ok: true }
        : { ok: false, problems: ["source: rejected call"] };
    const matchingSessionFile = measures.valid.sessionFile.replace(/_[^_]+\.jsonl$/u, `_${input.sessionId}.jsonl`);
    const fake = useFakePi([
      { args, stream: events, session: measures.valid.session, sessionFile: matchingSessionFile },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expectOneCall(fake, input, args);
    expect(outcome).toMatchObject({ kind: "success", structuredOutput: { source: "final text" } });
  });

  it("reports rejected candidates in order", async () => {
    const input = validInput({ jsonSchema: reviewAnswerJsonSchema() });
    const files = makeFiles();
    const args = expectedArgs(input, files);
    const events = [
      ...measures.valid.stdout,
      {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: '{"source":"final text"}' }] },
      },
    ];
    input.checkAnswer = (output) =>
      typeof output === "object" && output !== null && "findings" in output
        ? { ok: false, problems: ["findings: rejected"] }
        : { ok: false, problems: ["source: rejected"] };
    const matchingSessionFile = measures.valid.sessionFile.replace(/_[^_]+\.jsonl$/u, `_${input.sessionId}.jsonl`);
    const fake = useFakePi([
      { args, stream: events, session: measures.valid.session, sessionFile: matchingSessionFile },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expectOneCall(fake, input, args);
    expect(refusalOf(outcome).reason).toBe(
      "the assistant gave no structured answer:\n  - submit_answer: findings: rejected\n  - final text: source: rejected",
    );
  });

  it("reports a thrown caller check as a rejected candidate", async () => {
    const input = validInput({
      jsonSchema: reviewAnswerJsonSchema(),
      checkAnswer: () => {
        throw new Error("check exploded");
      },
    });
    const files = makeFiles();
    const args = expectedArgs(input, files);
    const matchingSessionFile = measures.valid.sessionFile.replace(/_[^_]+\.jsonl$/u, `_${input.sessionId}.jsonl`);
    const fake = useFakePi([
      { args, stream: measures.valid.stdout, session: measures.valid.session, sessionFile: matchingSessionFile },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expectOneCall(fake, input, args);
    expect(refusalOf(outcome).reason).toBe(
      "the assistant gave no structured answer:\n  - submit_answer: the check of the answer threw: check exploded",
    );
  });

  it("ignores the caller check when the run has no schema", async () => {
    const input = validInput({ checkAnswer: () => ({ ok: false, problems: ["unexpected rejection"] }) });
    const files = makeFiles();
    const args = expectedArgs(input, files, false);
    const fake = useFakePi([{ args, stream: measures.text.stdout, session: measures.text.session }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("success");
    expect(outcome).not.toHaveProperty("structuredOutput");
    expectOneCall(fake, input, args);
  });

  it("refuses a bad pi program before the fake logs a call", async () => {
    const files = makeFiles();
    const fake = useFakePi([]);
    const onSpawn = vi.fn();
    const input = validInput({ onSpawn });
    input.env = {
      ...input.env,
      ...fake.env,
      TASKER_PI_BIN: join(useTempDir("tasker-pi-missing-bin-"), "pi"),
    };

    const outcome = await callPi(input, files);

    expect(refusalOf(outcome).reason).toContain("TASKER_PI_BIN");
    expect(fake.calls()).toEqual([]);
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it("refuses an unwritable limits path before the fake logs a call", async () => {
    const files = makeFiles();
    const fake = useFakePi([]);
    const parentFile = join(useTempDir("tasker-pi-limits-parent-"), "file");
    writeFileSync(parentFile, "not a directory");
    const input = validInput({ sessionDir: parentFile });
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(refusalOf(outcome).reason).toContain("ENOTDIR");
    expect(fake.calls()).toEqual([]);
  });

  it("uses the final assistant message after failed retries", async () => {
    const files = makeFiles();
    const input = validInput();
    const args = [
      "-p",
      "--mode",
      "json",
      "--no-approve",
      "--provider",
      "openrouter",
      "--model",
      "openrouter/openrouter/openrouter/auto",
      "--thinking",
      "low",
      "--session-id",
      input.sessionId,
      "--session-dir",
      input.sessionDir,
      "--tools",
      "read,grep,find,ls",
      "--no-mcp",
      "-e",
      files.guardFile,
      "--tasker-guard-limits",
      guardLimitsPath(input.sessionDir, input.sessionId),
    ];
    const fake = useFakePi([{ args, stream: measures.failedRetry.stdout }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(refusalOf(outcome).reason).toBe("429 rate limit exceeded, overloaded");
  });
});
