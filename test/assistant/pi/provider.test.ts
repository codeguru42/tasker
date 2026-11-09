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
import { checkPlanAnswer, planAnswerJsonSchema } from "../../../src/plan/answer.js";
import { reviewAnswerJsonSchema } from "../../../src/review/answer.js";
import { failureOutcomeOf, runInput as sharedRunInput, TEST_SESSION_ID } from "../../helpers/fake-claude.js";
import { type FakePiAnswer, useFakePi } from "../../helpers/fake-pi.js";
import { validPlanAnswer } from "../../helpers/plan.js";
import { piQuotaStream } from "../../helpers/pi-quota-streams.js";
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
    ...sharedRunInput(),
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

const CORRECTIVE_SCHEMA = reviewAnswerJsonSchema();
const CORRECTIVE_ID = "m1id";
const CORRECTIVE_SESSION_EVENT = {
  type: "session",
  version: 3,
  id: "m1id",
  timestamp: "2026-11-08T02:21:45.167Z",
  cwd: "/scratch/work",
};
const TOOL_ADDED_SYSTEM_MESSAGE = {
  role: "system",
  content: "",
  timestamp: 1794104505223,
  toolsAdded: [{ name: "submit_answer" }],
};
const TOOL_REMOVED_SYSTEM_MESSAGE = {
  role: "system",
  content: "",
  timestamp: 1794104512793,
  toolsRemoved: [{ name: "submit_answer" }],
};

function correctiveInput(overrides: Partial<RunInput> = {}): RunInput {
  return validInput({
    sessionId: CORRECTIVE_ID,
    jsonSchema: CORRECTIVE_SCHEMA,
    correctiveTurns: 1,
    ...overrides,
  });
}

function correctivePrompt(problems: string[], schema: Record<string, unknown>): string {
  return [
    "Tasker refuses your last answer. Tasker found these problems:",
    "",
    problems.map((problem) => `- ${problem}`).join("\n"),
    "",
    "Give the whole answer again. Call the tool `submit_answer` one time, as your last action. If the tool is gone, end",
    "your reply with one JSON object in a fenced `json` block. The answer must match this JSON Schema:",
    "",
    "```json",
    JSON.stringify(schema, null, 2),
    "```",
  ].join("\n");
}

function continuationUserMessage() {
  return {
    role: "user",
    content: [{ type: "text", text: "Tasker refuses your last answer. Fix it." }],
    timestamp: 1794104505224,
  };
}

function continuationSession(messages: unknown[] = []): unknown[] {
  return [
    CORRECTIVE_SESSION_EVENT,
    ...messages.map((message, index) => ({
      type: "message",
      id: `m1-${index}`,
      parentId: index === 0 ? "parent-m1" : `m1-${index - 1}`,
      timestamp: `2026-11-08T02:21:45.${String(227 + index).padStart(3, "0")}Z`,
      message,
    })),
  ];
}

function firstSession(input: RunInput, messages: unknown[] = []): unknown[] {
  return [
    { ...CORRECTIVE_SESSION_EVENT },
    ...messages.map((message, index) => ({
      type: "message",
      id: `m0-${index}`,
      parentId: index === 0 ? "parent-m1" : `m0-${index - 1}`,
      timestamp: `2026-11-08T02:20:34.${String(300 + index).padStart(3, "0")}Z`,
      message,
    })),
    {
      type: "message",
      id: "m0-prompt",
      parentId: "parent-m1",
      timestamp: "2026-11-08T02:20:34.301Z",
      message: { role: "user", content: [{ type: "text", text: input.prompt }], timestamp: "2026-11-08T02:20:34.301Z" },
    },
  ];
}

function firstTextStream(input: RunInput): unknown[] {
  const stream = structuredClone(measures.text.stdout);
  stream[0] = { ...CORRECTIVE_SESSION_EVENT };
  const user = stream.find(
    (event) => event.type === "message_end" && (event.message as { role?: string }).role === "user",
  );
  if (user !== undefined) {
    (user.message as { content: { text: string }[] }).content[0].text = input.prompt;
  }
  return stream;
}

function firstCallStream(input: RunInput, answer?: unknown): unknown[] {
  const stream = structuredClone(measures.valid.stdout);
  stream[0] = { ...CORRECTIVE_SESSION_EVENT };
  const user = stream.find(
    (event) => event.type === "message_end" && (event.message as { role?: string }).role === "user",
  );
  if (user !== undefined) {
    (user.message as { content: { text: string }[] }).content[0].text = input.prompt;
  }
  if (answer !== undefined) {
    const assistant = stream.find(
      (event) => event.type === "message_end" && (event.message as { role?: string }).role === "assistant",
    );
    if (assistant !== undefined) {
      const message = assistant.message as { content: { type: string; arguments?: unknown }[] };
      const call = message.content.find((item) => item.type === "toolCall");
      if (call !== undefined) call.arguments = answer;
    }
  }
  return stream;
}

function firstThreeRejectedStream(input: RunInput): unknown[] {
  const user = { role: "user", content: [{ type: "text", text: input.prompt }], timestamp: 1794104512787 };
  const calls = ["c1", "c2", "c3"].flatMap((id) => [
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id, name: PI_ANSWER_TOOL_NAME, arguments: { findings: "x" } }],
      },
    },
    {
      type: "message_end",
      message: { role: "toolResult", toolCallId: id, toolName: PI_ANSWER_TOOL_NAME, isError: true },
    },
  ]);
  const assistant = { role: "assistant", content: [{ type: "text", text: "gave up" }], stopReason: "stop" };
  return [
    { ...CORRECTIVE_SESSION_EVENT },
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: user },
    { type: "message_end", message: user },
    ...calls,
    { type: "message_start", message: TOOL_REMOVED_SYSTEM_MESSAGE },
    { type: "message_end", message: TOOL_REMOVED_SYSTEM_MESSAGE },
    { type: "message_start", message: assistant },
    { type: "message_end", message: assistant },
    { type: "turn_end" },
    { type: "agent_end", messages: [user, assistant], willRetry: false },
    { type: "agent_settled", aborted: false },
  ];
}

function continuationTextStream(text: string, options: { agentEnd?: boolean } = {}) {
  const user = continuationUserMessage();
  const assistant = { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" };
  return [
    { ...CORRECTIVE_SESSION_EVENT },
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: TOOL_ADDED_SYSTEM_MESSAGE },
    { type: "message_end", message: TOOL_ADDED_SYSTEM_MESSAGE },
    { type: "message_start", message: user },
    { type: "message_end", message: user },
    { type: "message_start", message: { role: "assistant", content: [] } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text.slice(0, 1) } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text.slice(1, 2) } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text.slice(2) } },
    { type: "message_end", message: assistant },
    { type: "turn_end" },
    ...(options.agentEnd === false ? [] : [{ type: "agent_end", messages: [user, assistant], willRetry: false }]),
    { type: "agent_settled", aborted: false },
  ];
}

function continuationCallStream(answer: unknown, options: { accepted?: boolean; text?: string } = {}) {
  const user = continuationUserMessage();
  const call = {
    role: "assistant",
    content: [{ type: "toolCall", id: "c2", name: PI_ANSWER_TOOL_NAME, arguments: answer }],
    stopReason: "stop",
  };
  const result = {
    role: "toolResult",
    toolCallId: "c2",
    toolName: PI_ANSWER_TOOL_NAME,
    content: [{ type: "text", text: options.accepted === false ? "Validation failed" : "Answer accepted." }],
    isError: options.accepted === false,
  };
  const text =
    options.text === undefined ? undefined : { role: "assistant", content: [{ type: "text", text: options.text }] };
  return [
    { ...CORRECTIVE_SESSION_EVENT },
    { type: "agent_start" },
    { type: "turn_start" },
    { type: "message_start", message: TOOL_ADDED_SYSTEM_MESSAGE },
    { type: "message_end", message: TOOL_ADDED_SYSTEM_MESSAGE },
    { type: "message_start", message: user },
    { type: "message_end", message: user },
    { type: "message_start", message: call },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "call" } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " arguments" } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: " ready" } },
    { type: "message_end", message: call },
    {
      type: "tool_execution_end",
      toolCallId: "c2",
      toolName: PI_ANSWER_TOOL_NAME,
      isError: options.accepted === false,
    },
    { type: "message_end", message: result },
    ...(text === undefined ? [] : [{ type: "message_end", message: text }]),
    { type: "turn_end" },
    { type: "agent_end", messages: text === undefined ? [user, call] : [user, call, text], willRetry: false },
    { type: "agent_settled", aborted: false },
  ];
}

type PiScript = Omit<FakePiAnswer, "args">;

function processScripts(input: RunInput, files: PiFiles, scripts: PiScript[]): ReturnType<typeof useFakePi> {
  const firstArgs = expectedArgs({ ...input, resume: false }, files);
  const continuedArgs = expectedArgs({ ...input, resume: true }, files);
  return useFakePi(scripts.map((script, index) => ({ ...script, args: index === 0 ? firstArgs : continuedArgs })));
}

function expectProcessSequence(
  fake: ReturnType<typeof useFakePi>,
  input: RunInput,
  files: PiFiles,
  prompts: string[],
): void {
  const calls = fake.calls();
  const firstArgs = expectedArgs({ ...input, resume: false }, files);
  const continuedArgs = expectedArgs({ ...input, resume: true }, files);
  expect(calls).toHaveLength(prompts.length);
  expect(calls.map((call) => call.stdin)).toEqual(prompts);
  expect(calls.map((call) => call.args)).toEqual(
    prompts.map((_prompt, index) => (index === 0 ? firstArgs : continuedArgs)),
  );
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
  it.each([
    ["quotaDelay", "quota", 3600],
    ["quotaDate", "quota", 1793779200],
    ["quotaNoRetryAfter", "quota", undefined],
    ["quotaCutComplete", "quota", 3600],
    ["quotaCutValue", "quota", undefined],
    ["quotaSpaceWhole", "quota", 3600],
    ["quotaSpaceNoBody", "quota", undefined],
    ["error429Colon", "failure", undefined],
    ["error429Space", "failure", undefined],
    ["retryWorks", "success", undefined],
    ["retryFails", "quota", 3600],
  ] as const)("reads the final quota result from %s", async (name, kind, resetsAt) => {
    const files = makeFiles();
    const input = validInput({ overageStop: { approvedResetsAt: 1793779200 } });
    const args = expectedArgs(input, files);
    const fixture = piQuotaStream(name);
    const fake = useFakePi([
      { args, stream: fixture.stdout, session: fixture.session, sessionFile: fixture.sessionFile },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe(kind);
    if (kind === "quota") {
      expect(outcome).toMatchObject({ kind: "quota", cause: "rate_limit", usage: "unavailable" });
      if (resetsAt === undefined) expect(outcome).not.toHaveProperty("resetsAt");
      else if (name === "quotaDate") expect(outcome).toMatchObject({ resetsAt });
      else {
        const quota = outcome as Extract<RunOutcome, { kind: "quota" }>;
        expect(quota.resetsAt).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + resetsAt);
        expect(quota.resetsAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + resetsAt);
      }
    }
    const provider = fromCreatePiProvider(files);
    expect(provider.detectQuotaApprovalWarning(outcome, 0.9)).toBeUndefined();
    expect(provider.shouldSuppressQuotaApprovalPause({ utilization: 0.95 }, undefined)).toBe(false);
    for (const event of fixture.stdout) {
      expect(provider.isQuotaEvent(event)).toBe(false);
    }
  });

  it("gives quota priority over a nonzero exit", async () => {
    const files = makeFiles();
    const input = validInput();
    const fixture = piQuotaStream("quotaDelay");
    const fake = useFakePi([{ args: expectedArgs(input, files), stream: fixture.stdout, exitCode: 4 }]);
    input.env = { ...input.env, ...fake.env };
    expect(await callPi(input, files)).toMatchObject({ kind: "quota", cause: "rate_limit" });
  });

  it("uses a session-file quota result when the stream has no agent end", async () => {
    const files = makeFiles();
    const input = validInput();
    const fixture = piQuotaStream("quotaDelay");
    const stream = fixture.stdout.filter(
      (event) =>
        event.type !== "agent_end" &&
        !(event.type === "message_end" && (event.message as { role?: string }).role === "assistant"),
    );
    const fake = useFakePi([
      { args: expectedArgs(input, files), stream, session: fixture.session, sessionFile: fixture.sessionFile },
    ]);
    input.env = { ...input.env, ...fake.env };
    expect(await callPi(input, files)).toMatchObject({
      kind: "quota",
      cause: "rate_limit",
      resetsAt: expect.any(Number),
    });
  });

  it("gives quota priority over a passed SIGTERM", async () => {
    const files = makeFiles();
    const input = validInput({ onSpawn: () => process.kill(process.pid, "SIGTERM") });
    const fixture = piQuotaStream("quotaDelay");
    const fake = useFakePi([{ args: expectedArgs(input, files), stream: fixture.stdout, delaySeconds: 0.2 }]);
    input.env = { ...input.env, ...fake.env };
    expect(await callPi(input, files)).toMatchObject({ kind: "quota", cause: "rate_limit" });
  });

  it("keeps the deadline ahead of quota", async () => {
    const files = makeFiles();
    const input = validInput({ timeoutMs: 50 });
    const fixture = piQuotaStream("quotaDelay");
    const fake = useFakePi([{ args: expectedArgs(input, files), stream: fixture.stdout, delaySeconds: 0.4 }]);
    input.env = { ...input.env, ...fake.env };
    expect(await callPi(input, files)).toMatchObject({ kind: "timeout" });
  });

  it("ignores a quota message from an earlier session-file run", async () => {
    const files = makeFiles();
    const input = validInput();
    mkdirSync(input.sessionDir, { recursive: true });
    const old = piQuotaStream("quotaDelay").session.at(-1);
    writeFileSync(join(input.sessionDir, `old_${input.sessionId}.jsonl`), `${JSON.stringify(old)}\n`);
    const fake = useFakePi([{ args: expectedArgs(input, files), stream: firstTextStream(input) }]);
    input.env = { ...input.env, ...fake.env };
    expect(await callPi(input, files)).toMatchObject({ kind: "success" });
  });

  it("does not start a correction after quota on the first process", async () => {
    const files = makeFiles();
    const input = correctiveInput();
    const fixture = piQuotaStream("quotaDelay");
    const fake = useFakePi([{ args: expectedArgs(input, files), stream: fixture.stdout }]);
    input.env = { ...input.env, ...fake.env };
    expect(await callPi(input, files)).toMatchObject({ kind: "quota", cause: "rate_limit" });
    expect(fake.calls()).toHaveLength(1);
  });

  it("uses quota from the corrective process", async () => {
    const files = makeFiles();
    const input = correctiveInput();
    const fixture = piQuotaStream("quotaDelay");
    const fake = processScripts(input, files, [
      {
        stream: firstTextStream(input),
        session: firstSession(input, [
          { role: "assistant", content: [{ type: "text", text: "no structured answer" }], stopReason: "stop" },
        ]),
      },
      { stream: fixture.stdout, session: fixture.session, sessionFile: fixture.sessionFile },
    ]);
    input.env = { ...input.env, ...fake.env };
    expect(await callPi(input, files)).toMatchObject({ kind: "quota", cause: "rate_limit" });
    expect(fake.calls()).toHaveLength(2);
  });

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

describe("pi corrective turns", () => {
  it("reruns extension refusals before a corrective turn", async () => {
    const agentDir = join(useTempDir("tasker-pi-agent-"), "agent");
    const input = correctiveInput({
      env: { HOME: "/home/user", TASKER_PI_CODING_AGENT_DIR: agentDir },
      checkAnswer: () => {
        mkdirSync(join(agentDir, "extensions"), { recursive: true });
        writeFileSync(join(agentDir, "extensions", "untrusted.js"), "");
        return { ok: false, problems: [] };
      },
    });
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { stream: firstCallStream(input), session: firstSession(input) },
      { stream: continuationCallStream({ findings: [] }), session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(fake.calls()).toHaveLength(1);
    expect(refusalOf(outcome).reason).toBe(
      "the assistant gave no structured answer:\n  - no accepted call of submit_answer and no JSON object in the final text",
    );
  });

  it("uses a valid answer call from the correction", async () => {
    const input = correctiveInput();
    const files = makeFiles();
    const schema = input.jsonSchema!;
    const first = firstTextStream(input);
    const second = continuationCallStream({ findings: [] });
    const fake = processScripts(input, files, [
      { stream: first, session: firstSession(input) },
      { stream: second, session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome).toMatchObject({ kind: "success", structuredOutput: { findings: [] } });
    expectProcessSequence(fake, input, files, [
      input.prompt,
      correctivePrompt(["no accepted call of submit_answer and no JSON object in the final text"], schema),
    ]);
  });

  it("uses correction text after a rejected call", async () => {
    const input = correctiveInput({
      checkAnswer: (value) =>
        typeof value === "object" &&
        value !== null &&
        "findings" in value &&
        Array.isArray(value.findings) &&
        value.findings[0] === "good"
          ? { ok: true }
          : { ok: false, problems: ["bad call"] },
    });
    const files = makeFiles();
    const first = firstCallStream(input, { findings: ["bad"] });
    const second = continuationCallStream({ findings: ["bad"] }, { accepted: false, text: '{"findings":["good"]}' });
    const fake = processScripts(input, files, [
      { stream: first, session: firstSession(input) },
      { stream: second, session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome).toMatchObject({ kind: "success", structuredOutput: { findings: ["good"] } });
    expectProcessSequence(fake, input, files, [
      input.prompt,
      correctivePrompt(["submit_answer: bad call"], input.jsonSchema!),
    ]);
  });

  it("puts only call problems in the corrective prompt", async () => {
    const input = correctiveInput({ checkAnswer: () => ({ ok: false, problems: ["findings: rejected"] }) });
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { stream: firstCallStream(input, { findings: [] }), session: firstSession(input) },
      { stream: continuationTextStream('{"findings":[]}'), session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("failure");
    expectProcessSequence(fake, input, files, [
      input.prompt,
      correctivePrompt(["submit_answer: findings: rejected"], input.jsonSchema!),
    ]);
  });

  it("preserves schema placeholders inside corrective problems", async () => {
    const input = correctiveInput({
      checkAnswer: () => ({ ok: false, problems: ["<schema>: unrecognized key"] }),
    });
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { stream: firstCallStream(input, { findings: [] }), session: firstSession(input) },
      { stream: continuationCallStream({ findings: [] }), session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };

    await callPi(input, files);

    const correctiveStdin = fake.calls()[1]?.stdin;
    expect(correctiveStdin).toBe(correctivePrompt(["submit_answer: <schema>: unrecognized key"], input.jsonSchema!));
    expect(correctiveStdin).toContain("- submit_answer: <schema>: unrecognized key");
  });

  it("uses the plan check problem for a placeholder answer", async () => {
    const plan = validPlanAnswer();
    const placeholder = { ...plan, todos: plan.todos.map((todo) => ({ ...todo, title: "x" })) };
    const input = correctiveInput({
      jsonSchema: planAnswerJsonSchema(),
      checkAnswer: (value) => checkPlanAnswer(value),
    });
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { stream: firstCallStream(input, placeholder), session: firstSession(input) },
      { stream: continuationTextStream(JSON.stringify(plan)), session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("success");
    expect(fake.calls()).toHaveLength(2);
    expect(fake.calls().map((call) => call.stdin)).toEqual([
      input.prompt,
      expect.stringContaining("todos.0.title: is a placeholder, not real text"),
    ]);
    expect(fake.calls().map((call) => call.args)).toEqual([
      expectedArgs({ ...input, resume: false }, files),
      expectedArgs({ ...input, resume: true }, files),
    ]);
  });

  it.each([0, 2])("starts corrections up to the configured limit %i", async (limit) => {
    const checkAnswer =
      limit === 2
        ? (output: unknown) => {
            const findings =
              typeof output === "object" && output !== null && "findings" in output && Array.isArray(output.findings)
                ? output.findings[0]
                : undefined;
            return {
              ok: false as const,
              problems: [findings === "last" ? "last process problem" : "second process problem"],
            };
          }
        : undefined;
    const input = correctiveInput({ correctiveTurns: limit, ...(checkAnswer === undefined ? {} : { checkAnswer }) });
    const files = makeFiles();
    const scripts: PiScript[] = Array.from({ length: limit + 1 }, (_value, index) => ({
      stream:
        index === 0
          ? firstTextStream(input)
          : continuationTextStream(index === 1 ? '{"findings":["second"]}' : '{"findings":["last"]}'),
      session: index === 0 ? firstSession(input) : continuationSession(),
    }));
    const fake = processScripts(input, files, scripts);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("failure");
    if (limit === 2) {
      expect(refusalOf(outcome).reason).toBe(
        "the assistant gave no structured answer:\n  - final text: last process problem",
      );
      expectProcessSequence(fake, input, files, [
        input.prompt,
        correctivePrompt(["no accepted call of submit_answer and no JSON object in the final text"], input.jsonSchema!),
        correctivePrompt(["final text: second process problem"], input.jsonSchema!),
      ]);
      expect(fake.calls()[2]?.stdin).toContain("- final text: second process problem");
    } else {
      expect(refusalOf(outcome).reason).toBe(
        "the assistant gave no structured answer:\n  - no accepted call of submit_answer and no JSON object in the final text",
      );
      expectProcessSequence(fake, input, files, [input.prompt]);
    }
  });

  it("does not correct a run without a schema", async () => {
    const input = validInput({
      jsonSchema: undefined,
      correctiveTurns: 2,
      checkAnswer: () => ({ ok: false, problems: ["ignored"] }),
    });
    const files = makeFiles();
    const fake = processScripts(input, files, [{ stream: firstTextStream(input), session: firstSession(input) }]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("success");
    expectProcessSequence(fake, input, files, [input.prompt]);
  });

  it("includes a thrown answer check in the correction prompt", async () => {
    const input = correctiveInput({
      checkAnswer: () => {
        throw new Error("check exploded");
      },
    });
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { stream: firstCallStream(input, { findings: [] }), session: firstSession(input) },
      { stream: continuationTextStream('{"findings":[]}'), session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("failure");
    expectProcessSequence(fake, input, files, [
      input.prompt,
      correctivePrompt(["submit_answer: the check of the answer threw: check exploded"], input.jsonSchema!),
    ]);
  });

  it.each([
    ["first process failure", { exitCode: 2 }],
    ["first process timeout", { delaySeconds: 2 }],
  ])("does not correct after a %s", async (label, script) => {
    const input = correctiveInput({ timeoutMs: label === "first process timeout" ? 1_000 : 5_000 });
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { ...script, stream: firstTextStream(input), session: firstSession(input) },
    ]);
    input.env = { ...input.env, ...fake.env };

    await callPi(input, files);

    expectProcessSequence(fake, input, files, [input.prompt]);
  });

  it.each(["failure", "timeout"] as const)("returns the preceding outcome after a correction %s", async (kind) => {
    const input = correctiveInput({ timeoutMs: kind === "timeout" ? 1_000 : 5_000 });
    const files = makeFiles();
    const correction = kind === "failure" ? { exitCode: 2 } : { delaySeconds: 2 };
    const fake = processScripts(input, files, [
      { stream: firstTextStream(input), session: firstSession(input) },
      { ...correction, stream: continuationTextStream("no result"), session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("failure");
    expect(refusalOf(outcome).reason).toBe(
      "the assistant gave no structured answer:\n  - no accepted call of submit_answer and no JSON object in the final text",
    );
    expectProcessSequence(fake, input, files, [input.prompt, expect.any(String)]);
  });

  it("does not correct after an interrupt of the first process", async () => {
    const fakeRef: { current?: ReturnType<typeof useFakePi> } = {};
    const input = correctiveInput({
      onSpawn: () => {
        const timer = setInterval(() => {
          if (fakeRef.current?.calls().length === 1) {
            clearInterval(timer);
            process.kill(process.pid, "SIGINT");
          }
        }, 10);
      },
    });
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { delaySeconds: 1, stream: firstTextStream(input), session: firstSession(input) },
    ]);
    fakeRef.current = fake;
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("interrupted");
    expectProcessSequence(fake, input, files, [input.prompt]);
  });

  it("uses the run deadline during a correction", async () => {
    const input = correctiveInput({ timeoutMs: 1_000 });
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { stream: firstTextStream(input), session: firstSession(input) },
      { delaySeconds: 2, stream: continuationTextStream("late"), session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };
    const started = Date.now();

    const outcome = await callPi(input, files);

    expect(Date.now() - started).toBeLessThan(1_800);
    expect(outcome.kind).toBe("failure");
    expect(refusalOf(outcome).reason).toBe(
      "the assistant gave no structured answer:\n  - no accepted call of submit_answer and no JSON object in the final text",
    );
    expectProcessSequence(fake, input, files, [input.prompt, expect.any(String)]);
  });

  it("does not start a correction when the check uses the remaining time", async () => {
    const input = correctiveInput({
      timeoutMs: 500,
      checkAnswer: (value) => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600);
        return value === null ? { ok: false, problems: ["no answer"] } : { ok: false, problems: ["rejected"] };
      },
    });
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { stream: firstCallStream(input, { findings: [] }), session: firstSession(input) },
    ]);
    input.env = { ...input.env, ...fake.env };

    await callPi(input, files);

    expectProcessSequence(fake, input, files, [input.prompt]);
  });

  it("passes an interrupt from a correction through", async () => {
    let processNumber = 0;
    const fakeRef: { current?: ReturnType<typeof useFakePi> } = {};
    const input = correctiveInput({
      onSpawn: () => {
        processNumber += 1;
        if (processNumber === 2) {
          const timer = setInterval(() => {
            if (fakeRef.current?.calls().length === 2) {
              clearInterval(timer);
              process.kill(process.pid, "SIGINT");
            }
          }, 10);
        }
      },
    });
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { stream: firstTextStream(input), session: firstSession(input) },
      { delaySeconds: 1, stream: continuationTextStream("wait"), session: continuationSession() },
    ]);
    fakeRef.current = fake;
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expectProcessSequence(fake, input, files, [input.prompt, expect.any(String)]);
    expect(outcome.kind).toBe("interrupted");
  });

  it("starts with a fresh rejected-call count on the correction", async () => {
    const input = correctiveInput();
    const files = makeFiles();
    const fake = processScripts(input, files, [
      { stream: firstThreeRejectedStream(input), session: firstSession(input) },
      { stream: continuationCallStream({ findings: [] }), session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("success");
    expectProcessSequence(fake, input, files, [
      input.prompt,
      expect.stringContaining("no accepted call of submit_answer"),
    ]);
    expect(fake.calls()[1].args).toContain(files.answerFile);
  });

  it("does not reuse an earlier answer from the session file", async () => {
    const input = correctiveInput();
    const files = makeFiles();
    const earlierAnswer = {
      role: "assistant",
      content: [{ type: "toolCall", id: "old", name: PI_ANSWER_TOOL_NAME, arguments: { findings: [] } }],
    };
    const fake = processScripts(input, files, [
      { stream: firstTextStream(input), session: firstSession(input, [earlierAnswer]) },
      {
        stream: continuationTextStream("plain text", { agentEnd: false }),
        session: continuationSession([continuationUserMessage(), earlierAnswer]),
      },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome.kind).toBe("failure");
    expect(refusalOf(outcome).reason).toBe(
      "the assistant gave no structured answer:\n  - no accepted call of submit_answer and no JSON object in the final text",
    );
    expectProcessSequence(fake, input, files, [input.prompt, expect.any(String)]);
  });

  it("combines process events in order", async () => {
    const input = correctiveInput();
    const files = makeFiles();
    const first = firstTextStream(input);
    const second = continuationTextStream('{"findings":[]}');
    const fake = processScripts(input, files, [
      { stream: first, session: firstSession(input) },
      { stream: second, session: continuationSession() },
    ]);
    input.env = { ...input.env, ...fake.env };

    const outcome = await callPi(input, files);

    expect(outcome).toMatchObject({ kind: "success", structuredOutput: { findings: [] } });
    expect(outcome.events).toEqual([...first, ...second]);
    expect(outcome.permissionDenials).toEqual([]);
    expectProcessSequence(fake, input, files, [input.prompt, expect.any(String)]);
  });
});
