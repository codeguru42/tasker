import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ChildResult, runChild } from "../../src/process/run-child.js";
import { gitOutput, gitTestEnv } from "../helpers/git.js";
import { repoRoot } from "../helpers/processes.js";
import { treeSnapshot, useTempDir, useTempHome, writeFileWithParents } from "../helpers/temp.js";

interface DenialRepo {
  clone: string;
  env: NodeJS.ProcessEnv;
  home: string;
  out: string;
  script: string;
}

async function useDenialRepo(origin = "https://github.com/codeguru42/tasker.git"): Promise<DenialRepo> {
  const dir = useTempDir("tasker-denial-records-");
  const clone = join(dir, "clone");
  const { HOME: home } = useTempHome();
  const env = gitTestEnv(home);
  mkdirSync(clone);
  await gitOutput({ cwd: clone }, env, "init", "-b", "main");
  await gitOutput({ cwd: clone }, env, "remote", "add", "origin", origin);
  await gitOutput({ cwd: clone }, env, "commit", "--allow-empty", "-m", "init");
  const script = join(clone, "scripts", "denial-records.ts");
  mkdirSync(join(clone, "scripts"));
  const source = new URL("scripts/denial-records.ts", repoRoot);
  copyFileSync(source, script);
  return { clone, env, home, out: useTempDir("tasker-denial-out-"), script };
}

function runScript(script: string, cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<ChildResult> {
  return runChild(process.execPath, [script, ...args], { cwd, env });
}

interface TranscriptOptions {
  agentName?: string;
  metadataName?: string;
  customTitle?: string;
  sessionId?: string;
  cwd?: string;
  toolUseId?: string;
  tool?: string;
  command?: string;
  timestamp?: string;
  permissionMode?: string;
  assistantText?: string;
  resultBlocks?: unknown[];
  extraLines?: string[];
  omitCwd?: boolean;
  omitDecision?: boolean;
  agentNames?: string[];
  secondRowCwd?: string;
}

function projectFolder(home: string, cwd: string): string {
  return join(home, ".claude", "projects", cwd.replaceAll("/", "-"));
}

function writeTranscript(home: string, options: TranscriptOptions = {}): string {
  const sessionId = options.sessionId ?? "session-main";
  const cwd = options.cwd ?? "/tmp/clone";
  const toolUseId = options.toolUseId ?? "toolu-denied";
  const command = options.command ?? "git status";
  const folder = projectFolder(home, cwd);
  const mainPath = join(folder, `${sessionId}.jsonl`);
  const first = JSON.stringify({
    type: "system",
    timestamp: "2026-11-07T11:59:59.000Z",
    version: "2.0.0",
    cwd: options.omitCwd ? undefined : cwd,
    gitBranch: "main",
    sessionId,
    isSidechain: false,
    permissionDecision: "allow",
    toolDenialKind: null,
    message: { model: "claude-test", content: [] },
  });
  const assistant = JSON.stringify({
    type: "assistant",
    timestamp: "2026-11-07T12:00:00.000Z",
    version: "2.0.0",
    cwd: options.omitCwd ? undefined : cwd,
    gitBranch: "main",
    sessionId,
    isSidechain: false,
    permissionDecision: "allow",
    toolDenialKind: null,
    message: {
      model: "claude-test",
      content: [
        { type: "text", text: options.assistantText ?? "I will check the repository." },
        { type: "tool_use", id: toolUseId, name: options.tool ?? "Bash", input: { command } },
      ],
    },
  });
  const results = JSON.stringify({
    type: "user",
    version: "2.0.0",
    cwd: options.omitCwd ? undefined : cwd,
    gitBranch: "main",
    sessionId,
    isSidechain: false,
    timestamp: options.timestamp ?? "2026-11-07T12:00:01.000Z",
    ...(options.omitDecision ? {} : { permissionDecision: { decision: "reject", reasonType: "classifier" } }),
    toolDenialKind: "classifier",
    message: { model: "claude-test", content: options.resultBlocks ?? [denialBlock(toolUseId)] },
  });
  writeFileWithParents(
    mainPath,
    [
      first,
      ...(options.secondRowCwd ? [JSON.stringify({ type: "progress", cwd: options.secondRowCwd })] : []),
      ...(options.agentNames ?? (options.agentName ? [options.agentName] : [])).map((agentName) =>
        JSON.stringify({ type: "agent-name", agentName }),
      ),
      ...(options.customTitle ? [JSON.stringify({ type: "custom-title", customTitle: options.customTitle })] : []),
      ...(options.permissionMode
        ? [JSON.stringify({ type: "permission-mode", permissionMode: options.permissionMode })]
        : []),
      assistant,
      results,
      ...(options.extraLines ?? []),
    ].join("\n") + "\n",
  );
  writeFileWithParents(
    join(folder, `${sessionId}.meta.json`),
    JSON.stringify({ sessionId, cwd, name: options.metadataName }),
  );
  return mainPath;
}

function denialBlock(
  toolUseId: string,
  text = "Permission for this action was denied by the Claude Code auto mode classifier.",
  type = "tool_result",
): unknown {
  return { type, tool_use_id: toolUseId, content: [{ type: "text", text }], is_error: type === "tool_result" };
}

function scanArgs(fixture: DenialRepo, out = fixture.out): string[] {
  return [
    "scan",
    "--store",
    join(useTempDir("tasker-denial-store-"), "store.jsonl"),
    "--out",
    out,
    "--transcripts",
    join(fixture.home, ".claude", "projects"),
  ];
}

async function scan(fixture: DenialRepo, ...args: string[]): Promise<ChildResult> {
  const outIndex = args.indexOf("--out");
  if (outIndex >= 0 && args[outIndex + 1]) fixture.out = args[outIndex + 1];
  const withTranscripts = args.includes("--transcripts")
    ? args
    : [...args, "--transcripts", join(fixture.home, ".claude", "projects")];
  return runScript(fixture.script, fixture.clone, fixture.env, ...withTranscripts);
}

function recordsFrom(fixture: DenialRepo, output: string): Record<string, unknown>[] {
  const text = readFileSync(join(fixture.out, "records.jsonl"), "utf8").trim();
  if (/^[1-9]\d* denials/.test(output.trim()) && !text) {
    throw new Error("scan printed records but did not write records.jsonl");
  }
  return text ? text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>) : [];
}

interface LaterCall {
  command: string;
  outcome?: "allowed" | "denied" | "missing" | "no-decision";
  timestamp?: string;
  tool?: string;
  toolUseId?: string;
}

function appendLaterCalls(path: string, sessionId: string, calls: LaterCall[]): void {
  for (const [index, call] of calls.entries()) {
    const toolUseId = call.toolUseId ?? `later-${index}`;
    const timestamp = call.timestamp ?? `2026-11-07T12:00:${String(index + 2).padStart(2, "0")}.000Z`;
    appendFileSync(
      path,
      `${JSON.stringify({
        type: "assistant",
        version: "2.0.0",
        cwd: "/tmp/clone",
        gitBranch: "main",
        isSidechain: false,
        permissionDecision: "allow",
        toolDenialKind: null,
        sessionId,
        timestamp,
        message: {
          model: "claude-test",
          content: [{ type: "tool_use", id: toolUseId, name: call.tool ?? "Bash", input: { command: call.command } }],
        },
      })}\n`,
    );
    if (call.outcome === "missing") continue;
    const denied = call.outcome === "denied";
    appendFileSync(
      path,
      `${JSON.stringify({
        type: "user",
        version: "2.0.0",
        cwd: "/tmp/clone",
        gitBranch: "main",
        isSidechain: false,
        sessionId,
        timestamp: new Date(Date.parse(timestamp) + 1000).toISOString(),
        ...(call.outcome === "no-decision"
          ? {}
          : {
              permissionDecision: denied
                ? { decision: "reject", reasonType: "permission rule" }
                : { decision: "allow" },
            }),
        toolDenialKind: null,
        message: {
          model: "claude-test",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: [{ type: "text", text: denied ? "Command denied." : "Command completed." }],
              is_error: denied,
            },
          ],
        },
      })}\n`,
    );
  }
}

function scanOne(
  fixture: DenialRepo,
  command: string,
  options: Omit<TranscriptOptions, "command"> = {},
): Promise<ChildResult> {
  writeTranscript(fixture.home, { cwd: fixture.clone, command, ...options });
  return scan(fixture, ...scanArgs(fixture));
}

function sampleRecord(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    id,
    time: "2026-11-07T12:00:01.000Z",
    session: {
      name: "planner-main",
      role: "planner",
      kind: "main",
      sessionId: "session-main",
      agentId: null,
      transcript: "session-main.jsonl",
      mainSession: null,
    },
    cwd: "/tmp/clone",
    gitBranch: "main",
    otherProject: false,
    claudeCodeVersion: "2.0.0",
    model: "claude-test",
    permissionMode: "default",
    call: { tool: "Bash", input: { command: "git status" } },
    denial: {
      kind: "classifier",
      text: "Permission was denied.",
      reason: null,
      decision: "reject",
      toolDenialKind: "classifier",
    },
    form: { plain: true, kinds: [], outsidePaths: [], parts: [] },
    settings: { readAt: "2026-11-07T12:00:00.000Z", files: [] },
    laterTries: [],
    comparison: { form: {}, writeKeys: {} },
    assistantText: "Checking status.",
    ...extra,
  };
}

interface StoreFixture extends DenialRepo {
  out: string;
  store: string;
}

function useStoreFixture(fixture: DenialRepo, records: Record<string, unknown>[], content?: string): StoreFixture {
  const out = useTempDir("tasker-denial-output-");
  const store = join(useTempDir("tasker-denial-store-"), "missing", "store.jsonl");
  writeFileWithParents(join(out, "records.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  if (content !== undefined) writeFileWithParents(store, content);
  return { ...fixture, out, store };
}

function storeArgs(fixture: StoreFixture, ...ids: string[]): string[] {
  return ["store", "--store", fixture.store, "--out", fixture.out, ...ids];
}

async function runStore(fixture: StoreFixture, ...ids: string[]): Promise<ChildResult> {
  return runScript(fixture.script, fixture.clone, fixture.env, ...storeArgs(fixture, ...ids));
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

function secret(...parts: string[]): string {
  return parts.join("");
}

describe("denial record command validation", () => {
  it("prints the two usage lines for invalid input", async () => {
    const { clone, env, script } = await useDenialRepo();
    const result = await runScript(script, clone, env, "unknown");

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "usage: node scripts/denial-records.ts scan --store <file> --out <folder> [--transcripts <folder>]\n",
    );
    expect(result.stderr).toContain(
      "       node scripts/denial-records.ts store --store <file> --out <folder> <record id>...\n",
    );
  });

  it("rejects missing and invalid command arguments", async () => {
    const { clone, env, script } = await useDenialRepo();
    const result = await runScript(script, clone, env, "scan", "--store");

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("usage");
  });

  it("allows a store path equal to the output folder", async () => {
    const { clone, env, script } = await useDenialRepo();
    const out = useTempDir("tasker-denial-out-");
    const result = await runScript(script, clone, env, "scan", "--store", out, "--out", out);

    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("same path");
    expect(existsSync(join(out, "records.jsonl"))).toBe(false);
  });

  it("rejects the records file inside the output folder as the store", async () => {
    const { clone, env, script } = await useDenialRepo();
    const out = join(useTempDir("tasker-denial-out-"), "records.jsonl");
    const result = await runScript(
      script,
      clone,
      env,
      "scan",
      "--store",
      join(out, "records.jsonl"),
      "--out",
      out,
      "--transcripts",
      useTempDir("tasker-denial-transcripts-"),
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("same");
    expect(existsSync(join(out, "records.jsonl"))).toBe(false);
  });

  it("rejects Git work-tree folders and their nearest existing ancestors", async () => {
    const { clone, env, script } = await useDenialRepo();
    const missing = join(clone, "missing", "child");
    const result = await runScript(
      script,
      clone,
      env,
      "scan",
      "--store",
      join(useTempDir("tasker-store-"), "store.jsonl"),
      "--out",
      missing,
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("git");
  });

  it("rejects .git folders", async () => {
    const { clone, env, script } = await useDenialRepo();
    const result = await runScript(
      script,
      clone,
      env,
      "scan",
      "--store",
      join(useTempDir("tasker-store-"), "store.jsonl"),
      "--out",
      join(clone, ".git"),
    );

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("git");
  });

  it("accepts folders outside Git and checks the nearest existing ancestor", async () => {
    const { clone, env, script } = await useDenialRepo();
    const out = join(useTempDir("tasker-denial-out-"), "missing", "child");
    const result = await runScript(
      script,
      clone,
      env,
      "scan",
      "--store",
      join(useTempDir("tasker-store-"), "store.jsonl"),
      "--out",
      out,
    );

    expect(result.code).toBe(0);
  });

  it.each([
    "https://github.com/codeguru42/tasker",
    "https://github.com/codeguru42/tasker.git",
    "git@github.com:codeguru42/tasker.git",
    "ssh://git@github.com/codeguru42/tasker.git",
  ])("accepts origin URL %s", async (origin) => {
    const { clone, env, script } = await useDenialRepo(origin);
    const out = useTempDir("tasker-out-");
    const result = await runScript(
      script,
      clone,
      env,
      "scan",
      "--store",
      join(useTempDir("tasker-store-"), "store.jsonl"),
      "--out",
      out,
    );
    expect(result.code).toBe(origin.startsWith("ssh://") ? 1 : 0);
    if (origin.startsWith("ssh://")) {
      expect(result.stdout).toBe("");
      expect(existsSync(join(out, "records.jsonl"))).toBe(false);
    }
  });

  it("rejects an invalid origin and can run from another repository", async () => {
    const fixture = await useDenialRepo("https://example.com/other/repo.git");
    const outside = useTempDir("tasker-other-repo-");
    writeFileWithParents(join(outside, "file"), "outside\n");
    const result = await runScript(
      fixture.script,
      outside,
      fixture.env,
      "scan",
      "--store",
      join(useTempDir("tasker-store-"), "store.jsonl"),
      "--out",
      useTempDir("tasker-out-"),
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("origin");
  });
});

describe("denial records from transcripts", () => {
  it("records only sessions whose first cwd is the clone", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone, sessionId: "eligible", toolUseId: "eligible-call" });
    writeTranscript(fixture.home, {
      cwd: `${fixture.clone}-worktrees/issue-1`,
      sessionId: "worktree",
      toolUseId: "worktree-call",
    });
    writeTranscript(fixture.home, { cwd: "/tmp/another-folder", sessionId: "other", toolUseId: "other-call" });
    writeTranscript(fixture.home, {
      sessionId: "missing-cwd",
      cwd: fixture.clone,
      omitCwd: true,
      toolUseId: "missing-cwd-call",
    });
    const result = await scan(fixture, ...scanArgs(fixture));

    expect(result.code).toBe(0);
    expect(recordsFrom(fixture, result.stdout)).toHaveLength(1);
    expect((recordsFrom(fixture, result.stdout)[0].session as { sessionId: string }).sessionId).toBe("eligible");
  });

  it("uses a cwd from a later transcript row", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, {
      sessionId: "later-cwd",
      cwd: fixture.clone,
      omitCwd: true,
      toolUseId: "later-cwd-call",
      secondRowCwd: fixture.clone,
    });
    const result = await scan(fixture, ...scanArgs(fixture));
    expect(recordsFrom(fixture, result.stdout)).toHaveLength(1);
  });

  it("keeps the first cwd and skips malformed JSON lines", async () => {
    const fixture = await useDenialRepo();
    const path = writeTranscript(fixture.home, {
      cwd: fixture.clone,
      sessionId: "first-cwd",
      extraLines: ["not json", JSON.stringify({ cwd: "/elsewhere", type: "assistant" })],
    });
    const before = treeSnapshot(join(fixture.home, ".claude"));
    const result = await scan(fixture, ...scanArgs(fixture));

    expect(result.code).toBe(0);
    expect(recordsFrom(fixture, result.stdout)).toHaveLength(1);
    expect(treeSnapshot(join(fixture.home, ".claude"))).toEqual(before);
    expect(path).toContain("first-cwd.jsonl");
  });

  it("uses the first cwd after a long line and skips later ineligible transcripts", async () => {
    const fixture = await useDenialRepo();
    const path = writeTranscript(fixture.home, { cwd: fixture.clone, sessionId: "long-cwd" });
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    lines[0] = JSON.stringify({ type: "progress", text: "x".repeat(70 * 1024) });
    lines.splice(1, 0, JSON.stringify({ type: "system", cwd: fixture.clone, sessionId: "long-cwd" }));
    writeFileWithParents(path, `${lines.join("\n")}\n`);
    writeTranscript(fixture.home, { cwd: "/tmp/not-this-clone", sessionId: "ineligible-long" });
    const result = await scan(fixture, ...scanArgs(fixture));
    expect(result.code).toBe(0);
    expect(
      recordsFrom(fixture, result.stdout).map((record) => (record.session as { sessionId: string }).sessionId),
    ).toEqual(["long-cwd"]);
  });

  it("reads main and subagent transcripts with their adjacent metadata", async () => {
    const fixture = await useDenialRepo();
    const main = writeTranscript(fixture.home, {
      cwd: fixture.clone,
      sessionId: "main-session",
      agentName: "planner-main",
      agentNames: ["planner-first", "planner-final"],
    });
    const folder = projectFolder(fixture.home, fixture.clone);
    const subagentFolder = join(folder, "main-session", "subagents");
    const subagent = join(subagentFolder, "agent-1.jsonl");
    writeFileWithParents(
      subagent,
      [
        JSON.stringify({ cwd: fixture.clone, sessionId: "main-session", agentId: "agent-1", type: "system" }),
        JSON.stringify({
          cwd: fixture.clone,
          sessionId: "main-session",
          agentId: "agent-1",
          type: "assistant",
          timestamp: "2026-11-07T12:00:00.000Z",
          message: {
            content: [{ type: "tool_use", id: "subagent-call", name: "Bash", input: { command: "git status" } }],
          },
        }),
        JSON.stringify({
          cwd: fixture.clone,
          sessionId: "main-session",
          agentId: "agent-1",
          type: "user",
          timestamp: "2026-11-07T12:00:01.000Z",
          message: { content: [denialBlock("subagent-call")] },
        }),
      ].join("\n") + "\n",
    );
    writeFileWithParents(
      join(subagentFolder, "agent-1.meta.json"),
      JSON.stringify({ agentId: "agent-1", name: "reviewer" }),
    );
    appendLaterCalls(main, "main-session", [{ command: "git status", outcome: "allowed", toolUseId: "main-later" }]);
    appendLaterCalls(subagent, "main-session", [
      { command: "git status", outcome: "allowed", toolUseId: "subagent-later" },
    ]);
    const before = treeSnapshot(join(fixture.home, ".claude"));
    const result = await scan(fixture, ...scanArgs(fixture));
    const records = recordsFrom(fixture, result.stdout);

    expect(result.code).toBe(0);
    expect(records).toHaveLength(2);
    expect(records.map((record) => (record.session as { name: string }).name)).toEqual(
      expect.arrayContaining(["planner-final", "reviewer"]),
    );
    expect(
      records.map((record) => (record.session as { kind: string; role: string; mainSession: string | null }).kind),
    ).toEqual(expect.arrayContaining(["main", "subagent"]));
    expect(records.find((record) => (record.session as { kind: string }).kind === "subagent")?.session).toMatchObject({
      role: "subagent",
      mainSession: { name: "planner-final", role: "planner" },
      transcript: "main-session/subagents/agent-1.jsonl",
    });
    expect(
      records.flatMap((record) =>
        (record.laterTries as { sessionName: string }[]).map((attempt) => attempt.sessionName),
      ),
    ).toEqual(expect.arrayContaining(["planner-final", "reviewer"]));
    expect(treeSnapshot(join(fixture.home, ".claude"))).toEqual(before);
    expect(main).toContain("main-session.jsonl");
  });

  it("ignores a shared project subagent folder", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone, sessionId: "main-only" });
    const shared = join(projectFolder(fixture.home, fixture.clone), "subagents", "agent-shared.jsonl");
    writeFileWithParents(shared, `${JSON.stringify({ cwd: fixture.clone, sessionId: "main-only", type: "system" })}\n`);
    const result = await scan(fixture, ...scanArgs(fixture));
    expect(result.code).toBe(0);
    expect(recordsFrom(fixture, result.stdout)).toHaveLength(1);
  });

  it.each([
    ["classifier decision denials", "Auto mode classifier rejected this command."],
    ["classifier error text denials", "Claude Code auto mode classifier denied the command."],
    ["the second classifier error text", "The auto mode classifier denied this command."],
  ])("finds %s", async (_name, denial) => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone, resultBlocks: [denialBlock("toolu-denied", denial)] });
    const result = await scan(fixture, ...scanArgs(fixture));

    expect(result.code).toBe(0);
    expect(recordsFrom(fixture, result.stdout)).toHaveLength(1);
  });

  it("marks classifier no-verdict results as check failures", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, {
      cwd: fixture.clone,
      resultBlocks: [denialBlock("toolu-denied", "auto mode classifier gave no verdict")],
    });
    const result = await scan(fixture, ...scanArgs(fixture));

    expect(result.code).toBe(0);
    const [record] = recordsFrom(fixture, result.stdout);
    expect((record.denial as { kind: string }).kind).toBe("check failure");
  });

  it("tests each tool result block and ignores quoted denial text", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, {
      cwd: fixture.clone,
      assistantText: 'The transcript once said "Auto mode classifier rejected this command."',
      resultBlocks: [
        { type: "tool_result", tool_use_id: "unrelated", content: "Permission was denied for another call." },
        denialBlock("toolu-denied"),
      ],
    });
    const result = await scan(fixture, ...scanArgs(fixture));

    expect(result.code).toBe(0);
    expect(recordsFrom(fixture, result.stdout)).toHaveLength(1);
    expect((recordsFrom(fixture, result.stdout)[0].call as { input: { command: string } }).input.command).toBe(
      "git status",
    );
    expect(recordsFrom(fixture, result.stdout)[0].assistantText).toContain(
      "Auto mode classifier rejected this command.",
    );
  });

  it("ignores classifier decisions on non-tool-result blocks", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, {
      cwd: fixture.clone,
      resultBlocks: [
        { type: "text", tool_use_id: "toolu-denied", text: "Auto mode classifier rejected this command." },
        { type: "error", tool_use_id: "toolu-denied", error: "Auto mode classifier rejected this command." },
      ],
    });
    const result = await scan(fixture, ...scanArgs(fixture));
    expect(result.code).toBe(0);
    expect(recordsFrom(fixture, result.stdout)).toHaveLength(0);
  });

  it("uses null when a denial has no permission decision", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone, omitDecision: true });
    const result = await scan(fixture, ...scanArgs(fixture));
    expect((recordsFrom(fixture, result.stdout)[0].denial as { decision: unknown }).decision).toBeNull();
  });

  it("matches calls in the same transcript and chooses the earliest duplicate id", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, {
      cwd: fixture.clone,
      sessionId: "later-session",
      command: "git status --short",
      toolUseId: "shared-id",
      timestamp: "2026-11-07T12:00:02.000Z",
      resultBlocks: [denialBlock("shared-id")],
    });
    writeTranscript(fixture.home, {
      cwd: fixture.clone,
      sessionId: "earlier-session",
      command: "git status",
      toolUseId: "shared-id",
      timestamp: "2026-11-07T12:00:01.000Z",
      resultBlocks: [denialBlock("shared-id")],
    });
    const result = await scan(fixture, ...scanArgs(fixture));
    const records = recordsFrom(fixture, result.stdout);

    expect(result.code).toBe(0);
    expect(records).toHaveLength(1);
    expect((records[0].session as { sessionId: string }).sessionId).toBe("earlier-session");
    expect((records[0].call as { input: { command: string } }).input).toEqual({ command: "git status" });
  });

  it("writes the exact record keys, nulls, session names, and permission mode", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, {
      cwd: fixture.clone,
      permissionMode: "acceptEdits",
      assistantText: "Checking status.",
    });
    const result = await scan(fixture, ...scanArgs(fixture));
    const [record] = recordsFrom(fixture, result.stdout);

    expect(Object.keys(record).sort()).toEqual(
      [
        "assistantText",
        "comparison",
        "cwd",
        "denial",
        "form",
        "id",
        "call",
        "claudeCodeVersion",
        "gitBranch",
        "laterTries",
        "otherProject",
        "permissionMode",
        "model",
        "schema",
        "session",
        "settings",
        "time",
      ].sort(),
    );
    expect(record.permissionMode).toBe("acceptEdits");
    expect(record.assistantText).toBe("Checking status.");
    expect((record.session as { name: string }).name).toBe("-");
    expect(record.comparison).not.toBeNull();
    expect(record.form).not.toBeNull();
    expect(Object.keys(record.denial as object).sort()).toEqual(
      ["kind", "text", "reason", "decision", "toolDenialKind"].sort(),
    );
    expect((record.denial as { decision: object | null }).decision).toEqual({
      reasonType: "classifier",
      reasonCode: null,
      classifierCategory: null,
    });
  });

  it("uses measured agent and title fields and ignores a title that looks like a mode", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, {
      cwd: fixture.clone,
      agentName: "planner-main",
      customTitle: "permission-mode:dangerouslySkipPermissions",
    });
    const result = await scan(fixture, ...scanArgs(fixture));
    const [record] = recordsFrom(fixture, result.stdout);
    expect((record.session as { name: string; role: string }).name).toBe("planner-main");
    expect((record.session as { role: string }).role).toBe("planner");
    expect(record.permissionMode).toBeNull();
  });

  it("uses a custom title as the session name and a dash for a missing role", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone, customTitle: "Review this change" });
    const result = await scan(fixture, ...scanArgs(fixture));
    const [record] = recordsFrom(fixture, result.stdout);
    expect((record.session as { name: string; role: string }).name).toBe("Review this change");
    expect((record.session as { role: string }).role).toBe("-");
  });

  it("keeps classifier fields and transcript-named paths out of records", async () => {
    const fixture = await useDenialRepo();
    const path = writeTranscript(fixture.home, { cwd: fixture.clone });
    const append = JSON.stringify({
      cwd: fixture.clone,
      sessionId: "session-main",
      type: "assistant",
      serverClassifierContext: "private classifier context",
      serverClassifierRequest: "private classifier request",
      message: { content: [{ type: "text", text: `Read ${path} and /tmp/named-transcript.jsonl` }] },
    });
    appendFileSync(path, `${append}\n`);
    const result = await scan(fixture, ...scanArgs(fixture));

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("private classifier");
    expect(result.stdout).not.toContain("named-transcript.jsonl");
  });
});

describe("Bash denial comparisons", () => {
  const commands = {
    a: "tail -n +3 /tmp/tasker/m16/drafts/768-comment.md > /tmp/tasker/m16/drafts/768-comment-body.md && gh issue comment 768 --body-file /tmp/tasker/m16/drafts/768-comment-body.md",
    b: `s=$(tasker status) && st=$(gh issue view 751 --repo codeguru42/tasker --json state -q .state) && if echo "$s" | grep -q 'codeguru42/tasker#751 '; then echo "IN FLIGHT: skip"; elif [ "$st" != OPEN ]; then echo "STATE $st: skip"; else gh issue edit 751 --repo codeguru42/tasker --add-blocked-by 800; fi`,
    d: "W=$HOME/src/mine/tasker-worktrees/codeguru42-tasker-722; B=issue-722-task-runs-add-three-secret-files-of-pi-to-the-read-deny-list-and-pass-the-folders-of-pi-to; cd $W || exit 1; git rev-parse --verify $B && git push -u origin $B",
    e: "for n in 723 725 726 731; do gh issue comment $n --repo codeguru42/tasker --body-file note$n.md; done",
    f: `s=$(tasker status) && json=$(gh issue view 783 --repo codeguru42/tasker --json title,body) && h=$(printf '%s\\n' "$json" | sha256sum | cut -d' ' -f1) && if echo "$s" | grep -q 'codeguru42/tasker#783 '; then echo "IN FLIGHT: skip"; elif [ "$h" != 535678780812f3fcf62c67e6eac2557b881dda217bb357fa3438f4a43c79a714 ]; then echo "HASH CHANGED: skip ($h)"; else gh issue edit 783 --repo codeguru42/tasker --body-file /tmp/tasker/m16/drafts/783-hold-order-body.md; fi`,
  };

  const cases = [
    [
      "a",
      commands.a,
      ["&&", "redirect", "outside path"],
      ["/tmp/tasker/m16/drafts/768-comment.md", "/tmp/tasker/m16/drafts/768-comment-body.md"],
      ["gh issue comment 768"],
    ],
    ["b", commands.b, ["&&", ";", "pipe", "if", "$(...)", "variable"], [], ["gh issue edit 751"]],
    [
      "d",
      commands.d,
      ["&&", "||", ";", "cd", "variable", "outside path"],
      ["$HOME/src/mine/tasker-worktrees/codeguru42-tasker-722"],
      ["git push"],
    ],
    ["e", commands.e, [";", "loop"], [], ["gh issue comment $n"]],
    [
      "f",
      commands.f,
      ["&&", ";", "pipe", "if", "$(...)", "variable", "outside path"],
      ["/tmp/tasker/m16/drafts/783-hold-order-body.md"],
      ["gh issue edit 783"],
    ],
  ] as const;

  it.each(cases)("parses fact command %s", async (_label, command, kinds, outsidePaths, writeKeys) => {
    const fixture = await useDenialRepo();
    const result = await scanOne(fixture, command);
    const [record] = recordsFrom(fixture, result.stdout);
    const form = record.form as {
      plain: boolean;
      kinds: string[];
      outsidePaths: string[];
      parts: { key: string | null; write: boolean }[];
    };
    expect(result.code).toBe(0);
    expect(form.kinds).toEqual(kinds);
    expect(form.outsidePaths).toEqual(outsidePaths);
    expect(form.plain).toBe(false);
    expect(form.parts.filter((part) => part.write).map((part) => part.key)).toEqual(writeKeys);
  });

  it("does not mark paths inside cwd as outside paths", async () => {
    const fixture = await useDenialRepo();
    const command = `cat ${fixture.clone}/file && cat ${fixture.clone}/child/file && cat /tmp/outside-file`;
    const result = await scanOne(fixture, command);
    const [record] = recordsFrom(fixture, result.stdout);
    expect((record.form as { outsidePaths: string[] }).outsidePaths).toEqual(["/tmp/outside-file"]);
  });

  it.each([`cat '/tmp/outside-file'`, `cat "/tmp/outside-file"`])(
    "marks quoted outside paths as outside paths: %s",
    async (command) => {
      const fixture = await useDenialRepo();
      const result = await scanOne(fixture, command);
      const [record] = recordsFrom(fixture, result.stdout);
      const form = record.form as { kinds: string[]; outsidePaths: string[] };
      expect(form.outsidePaths).toEqual(["/tmp/outside-file"]);
      expect(form.kinds).toContain("outside path");
    },
  );

  it("does not mark a quoted path inside cwd as outside", async () => {
    const fixture = await useDenialRepo();
    const result = await scanOne(fixture, `cat '${fixture.clone}/file'`);
    const [record] = recordsFrom(fixture, result.stdout);
    const form = record.form as { kinds: string[]; outsidePaths: string[] };
    expect(form.outsidePaths).toEqual([]);
    expect(form.kinds).not.toContain("outside path");
  });

  it("keeps quoted command substitution parts exact", async () => {
    const fixture = await useDenialRepo();
    writeFileWithParents(
      join(fixture.home, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(echo *)"] } }),
    );
    const result = await scanOne(fixture, 'echo "$(date)"');
    const [record] = recordsFrom(fixture, result.stdout);
    const form = record.form as { parts: { text: string; allowRule: string | null }[] };
    expect(form.parts.map(({ text }) => text)).toEqual(['echo "$(date)"', "date"]);
    expect(form.parts[0]?.allowRule).toBe("Bash(echo *)");
  });

  it("marks gh api field writes", async () => {
    const fixture = await useDenialRepo();
    const result = await scanOne(
      fixture,
      "gh api repos/codeguru42/tasker/issues/831 -X PATCH -f state=closed -F labels[]=bug",
    );
    const [record] = recordsFrom(fixture, result.stdout);
    const form = record.form as { kinds: string[]; parts: { key: string | null; write: boolean }[] };
    expect(form.parts.some((part) => part.key === "gh api repos/codeguru42/tasker/issues/831" && part.write)).toBe(
      true,
    );
    expect(form.kinds).not.toContain("variable");
  });

  it("ignores heredoc bodies when it finds writes", async () => {
    const fixture = await useDenialRepo();
    const result = await scanOne(
      fixture,
      "cat <<'EOF'\nrm -rf /tmp/not-a-real-write\nprintf '%s' > /tmp/also-not-a-write\nEOF",
    );
    const [record] = recordsFrom(fixture, result.stdout);
    const form = record.form as { parts: { key: string | null; write: boolean }[] };
    expect(form.parts.some((part) => part.write)).toBe(false);
  });

  it("matches the first allow rule for each part", async () => {
    const fixture = await useDenialRepo();
    writeFileWithParents(
      join(fixture.home, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(tasker *)", "Bash(gh *)"] } }),
    );
    const result = await scanOne(fixture, "tasker status && gh issue view 751");
    const [record] = recordsFrom(fixture, result.stdout);
    const form = record.form as { parts: { text: string; allowRule: string | null }[] };
    expect(form.parts.map((part) => part.allowRule)).toEqual(["Bash(tasker *)", "Bash(gh *)"]);
  });

  it("ignores missing and invalid settings", async () => {
    const fixture = await useDenialRepo();
    writeFileWithParents(join(fixture.home, ".claude", "settings.json"), "not json");
    const result = await scanOne(fixture, "tasker status");
    const [record] = recordsFrom(fixture, result.stdout);
    expect((record.settings as { files: string[] }).files).toEqual([]);
  });

  it("records settings files and read time", async () => {
    const fixture = await useDenialRepo();
    writeFileWithParents(
      join(fixture.home, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(*)"] } }),
    );
    const before = Date.now();
    const result = await scanOne(fixture, "tasker status");
    const after = Date.now();
    const [record] = recordsFrom(fixture, result.stdout);
    const settings = record.settings as { readAt: string; files: string[] };
    expect(Date.parse(settings.readAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(settings.readAt)).toBeLessThanOrEqual(after);
    expect(settings.files).toEqual([join(fixture.home, ".claude", "settings.json")]);
  });

  it("marks commands that target another repository", async () => {
    const fixture = await useDenialRepo();
    const result = await scanOne(fixture, "gh issue view 831 --repo outside-owner/other-project");
    const [record] = recordsFrom(fixture, result.stdout);
    expect(record.otherProject).toBe(true);
  });

  it("finds later tries across eligible sessions", async () => {
    const fixture = await useDenialRepo();
    const first = writeTranscript(fixture.home, {
      cwd: fixture.clone,
      sessionId: "first",
      toolUseId: "denial-first",
      command: "gh issue edit 751 --body x",
    });
    const second = writeTranscript(fixture.home, {
      cwd: fixture.clone,
      sessionId: "second",
      toolUseId: "denial-second",
      command: "gh issue edit 751 --body y",
    });
    appendLaterCalls(first, "first", [{ command: "gh issue edit 751 --body y", outcome: "allowed" }]);
    appendLaterCalls(second, "second", [{ command: "gh issue edit 751 --body y", outcome: "allowed" }]);
    const result = await scan(fixture, ...scanArgs(fixture));
    expect(recordsFrom(fixture, result.stdout)).toHaveLength(2);
    expect((recordsFrom(fixture, result.stdout)[0].laterTries as unknown[]).length).toBeGreaterThan(0);
  });

  it("deduplicates later calls", async () => {
    const fixture = await useDenialRepo();
    const path = writeTranscript(fixture.home, { cwd: fixture.clone });
    appendLaterCalls(path, "session-main", [
      { command: "git status", outcome: "allowed", toolUseId: "shared-later" },
      { command: "git status", outcome: "allowed", toolUseId: "shared-later" },
    ]);
    const result = await scan(fixture, ...scanArgs(fixture));
    const tries = recordsFrom(fixture, result.stdout)[0].laterTries as { toolUseId: string }[];
    expect(new Set(tries.map((tryItem) => tryItem.toolUseId)).size).toBe(tries.length);
    expect(Object.keys(tries[0]).sort()).toEqual(["command", "match", "outcome", "sessionId", "sessionName", "time"]);
  });

  it("limits later tries to ten", async () => {
    const fixture = await useDenialRepo();
    const path = writeTranscript(fixture.home, { cwd: fixture.clone });
    appendLaterCalls(
      path,
      "session-main",
      Array.from({ length: 11 }, () => ({ command: "git status", outcome: "allowed" as const })),
    );
    const result = await scan(fixture, ...scanArgs(fixture));
    const tries = recordsFrom(fixture, result.stdout)[0].laterTries as { time: string }[];
    expect(tries).toHaveLength(10);
    expect(tries.map((attempt) => attempt.time)).toEqual([...tries.map((attempt) => attempt.time)].sort());
  });

  it("labels every specified outcome fallback", async () => {
    const fixture = await useDenialRepo();
    const path = writeTranscript(fixture.home, { cwd: fixture.clone });
    appendLaterCalls(path, "session-main", [
      { command: "git status", outcome: "allowed" },
      { command: "git status", outcome: "denied" },
      { command: "git status", outcome: "no-decision" },
      { command: "git status", outcome: "missing" },
    ]);
    const result = await scan(fixture, ...scanArgs(fixture));
    const outcomes = (recordsFrom(fixture, result.stdout)[0].laterTries as { outcome: string }[]).map(
      (attempt) => attempt.outcome,
    );
    expect(outcomes).toEqual(["allow/-", "reject/permission rule", "unknown", "no result"]);
  });

  it("ignores allow decisions on blocks that are not tool results", async () => {
    const fixture = await useDenialRepo();
    const path = writeTranscript(fixture.home, { cwd: fixture.clone, command: "git status" });
    appendFileSync(
      path,
      `${JSON.stringify({
        type: "assistant",
        cwd: fixture.clone,
        sessionId: "session-main",
        timestamp: "2026-11-07T12:00:02.000Z",
        message: {
          content: [{ type: "tool_use", id: "text-result-call", name: "Bash", input: { command: "git status" } }],
        },
      })}\n${JSON.stringify({
        type: "user",
        cwd: fixture.clone,
        sessionId: "session-main",
        timestamp: "2026-11-07T12:00:03.000Z",
        permissionDecision: { decision: "allow" },
        message: { content: [{ type: "text", tool_use_id: "text-result-call", text: "Allowed" }] },
      })}\n`,
    );
    const result = await scan(fixture, ...scanArgs(fixture));
    const [record] = recordsFrom(fixture, result.stdout);
    expect(record.laterTries).toEqual([expect.objectContaining({ outcome: "no result", match: "same text" })]);
    expect(record.comparison).toEqual({
      form: { "no result": 1, "reject/classifier": 1 },
      writeKeys: {},
    });
  });

  it("does not read metadata beside a main transcript", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone });
    const first = await scan(fixture, ...scanArgs(fixture));
    const expected = recordsFrom(fixture, first.stdout).map((record) => {
      const settings = record.settings as { readAt: string };
      return { ...record, settings: { ...settings, readAt: "" } };
    });
    const metadataPath = join(projectFolder(fixture.home, fixture.clone), "session-main.meta.json");
    rmSync(metadataPath);
    mkdirSync(metadataPath);

    const second = await scan(fixture, ...scanArgs(fixture));

    expect(second.code).toBe(0);
    expect(
      recordsFrom(fixture, second.stdout).map((record) => {
        const settings = record.settings as { readAt: string };
        return { ...record, settings: { ...settings, readAt: "" } };
      }),
    ).toEqual(expected);
  });

  it("counts writes and forms across eligible calls", async () => {
    const fixture = await useDenialRepo();
    const command = "gh issue edit 751 --body x";
    const path = writeTranscript(fixture.home, { cwd: fixture.clone, command });
    appendLaterCalls(
      path,
      "session-main",
      Array.from({ length: 11 }, (_, index) => ({
        command,
        outcome: index % 2 === 0 ? ("allowed" as const) : ("denied" as const),
      })),
    );
    const result = await scan(fixture, ...scanArgs(fixture));
    const [record] = recordsFrom(fixture, result.stdout);
    expect(record.comparison).toEqual({
      form: { "allow/-": 6, "reject/classifier": 1, "reject/permission rule": 5 },
      writeKeys: {
        "gh issue edit 751": { "allow/-": 6, "reject/classifier": 1, "reject/permission rule": 5 },
      },
    });
  });

  it("counts denied calls by each matching write key and exact form", async () => {
    const fixture = await useDenialRepo();
    const original = "gh issue edit 751 --body a && gh issue edit 752 --body b";
    const path = writeTranscript(fixture.home, { cwd: fixture.clone, command: original, toolUseId: "denial-two-keys" });
    appendLaterCalls(path, "session-main", [
      { command: original, outcome: "denied", toolUseId: "denied-both" },
      { command: "gh issue edit 751 --body c", outcome: "allowed", toolUseId: "allowed-751" },
      { command: "gh issue edit 752 --body d", outcome: "denied", toolUseId: "denied-752" },
      { command: original, outcome: "allowed", toolUseId: "allowed-both" },
    ]);
    const result = await scan(fixture, ...scanArgs(fixture));
    const [record] = recordsFrom(fixture, result.stdout);
    expect(record.comparison).toEqual({
      form: { "allow/-": 1, "reject/classifier": 1, "reject/permission rule": 1 },
      writeKeys: {
        "gh issue edit 751": { "allow/-": 2, "reject/classifier": 1, "reject/permission rule": 1 },
        "gh issue edit 752": { "allow/-": 1, "reject/classifier": 1, "reject/permission rule": 2 },
      },
    });
  });

  it("parses each eligible call using its own folder", async () => {
    const fixture = await useDenialRepo();
    const folderA = join(fixture.clone, "packages", "a");
    const folderB = join(fixture.clone, "packages", "b");
    const sharedCommand = `echo x > ${join(folderA, "file.txt")}`;
    writeTranscript(fixture.home, {
      cwd: folderA,
      sessionId: "folder-a",
      toolUseId: "folder-a-denial",
      command: sharedCommand,
    });
    writeTranscript(fixture.home, {
      cwd: folderB,
      sessionId: "folder-b",
      toolUseId: "folder-b-denial",
      command: sharedCommand,
    });
    const result = await scan(fixture, ...scanArgs(fixture));
    const records = recordsFrom(fixture, result.stdout);
    expect(records).toHaveLength(2);
    const bySession = new Map(records.map((record) => [(record.session as { sessionId: string }).sessionId, record]));
    expect((bySession.get("folder-a")?.form as { outsidePaths: string[] }).outsidePaths).toEqual([]);
    expect((bySession.get("folder-a")?.comparison as { form: Record<string, number> }).form).toEqual({
      "reject/classifier": 1,
    });
    expect((bySession.get("folder-b")?.form as { outsidePaths: string[] }).outsidePaths).toContain(
      join(folderA, "file.txt"),
    );
    expect((bySession.get("folder-b")?.comparison as { form: Record<string, number> }).form).toEqual({
      "reject/classifier": 1,
    });
  });
});

describe("denial record store and redaction", () => {
  it("stores one JSON object per line", async () => {
    const fixture = await useDenialRepo();
    const records = [sampleRecord("one"), sampleRecord("two")];
    const storeFixture = useStoreFixture(fixture, records);
    const result = await runStore(storeFixture, "one", "two");
    const text = readFileSync(storeFixture.store, "utf8");
    const lines = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(result.code).toBe(0);
    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0]).sort()).toEqual(
      [
        "assistantText",
        "call",
        "claudeCodeVersion",
        "comparison",
        "cwd",
        "denial",
        "form",
        "gitBranch",
        "id",
        "laterTries",
        "model",
        "otherProject",
        "permissionMode",
        "schema",
        "session",
        "settings",
        "time",
      ].sort(),
    );
    expect(lines.map((record) => record.id)).toEqual(["one", "two"]);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("treats missing and empty store lines as no IDs", async () => {
    for (const content of [undefined, "\n\n"]) {
      const fixture = await useDenialRepo();
      const storeFixture = useStoreFixture(fixture, [sampleRecord("keep-me")], content);
      const result = await runStore(storeFixture, "keep-me");
      expect(result.code).toBe(0);
      expect(readFileSync(storeFixture.store, "utf8")).toContain('"id":"keep-me"');
    }
  });

  it("rejects an invalid store line in scan", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone });
    const out = useTempDir("tasker-scan-invalid-store-out-");
    const store = join(useTempDir("tasker-scan-invalid-store-"), "store.jsonl");
    writeFileWithParents(store, "not json\n");
    const before = readFileSync(store, "utf8");
    const result = await scan(fixture, "scan", "--store", store, "--out", out);
    expect(result.code).toBe(1);
    expect(readFileSync(store, "utf8")).toBe(before);
    expect(existsSync(join(out, "records.jsonl"))).toBe(false);
  });

  it("rejects an invalid store line in store", async () => {
    const fixture = await useDenialRepo();
    const storeFixture = useStoreFixture(fixture, [sampleRecord("keep-me")]);
    writeFileWithParents(storeFixture.store, "not json\n");
    const before = readFileSync(storeFixture.store, "utf8");
    const result = await runStore(storeFixture, "keep-me");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("JSON");
    expect(readFileSync(storeFixture.store, "utf8")).toBe(before);
  });

  it("writes every scanned record in time order", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, {
      cwd: fixture.clone,
      sessionId: "later",
      toolUseId: "later-id",
      timestamp: "2026-11-07T12:00:03.000Z",
    });
    writeTranscript(fixture.home, {
      cwd: fixture.clone,
      sessionId: "earlier",
      toolUseId: "earlier-id",
      timestamp: "2026-11-07T12:00:01.000Z",
    });
    const out = useTempDir("tasker-scan-all-");
    const store = join(useTempDir("tasker-scan-all-store-"), "store.jsonl");
    writeFileWithParents(store, `${JSON.stringify(sampleRecord("earlier-id"))}\n`);
    const result = await scan(fixture, "scan", "--store", store, "--out", out);
    const records = recordsFrom(fixture, result.stdout);
    expect(result.code).toBe(0);
    expect(records.map((record) => record.id)).toEqual(["earlier-id", "later-id"]);
    expect(records.map((record) => record.time)).toEqual(["2026-11-07T12:00:01.000Z", "2026-11-07T12:00:03.000Z"]);
  });

  it("prints new record lines and totals", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone, toolUseId: "summary-id", agentName: "planner-main" });
    const out = useTempDir("tasker-summary-out-");
    const result = await scan(
      fixture,
      "scan",
      "--store",
      join(useTempDir("tasker-summary-store-"), "store.jsonl"),
      "--out",
      out,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("summary-id 2026-11-07T12:00:01.000Z planner-main -");
    expect(result.stdout).toContain("1 denials, 1 new");
    expect(result.stdout).not.toContain('{"schema"');
  });

  it("uses a dash when no measured session name exists", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone, toolUseId: "unnamed-id" });
    const result = await scan(fixture, ...scanArgs(fixture));
    expect(result.stdout).toContain("unnamed-id 2026-11-07T12:00:01.000Z - -");
  });

  it("sets scan folder and file modes", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone });
    const out = join(useTempDir("tasker-scan-modes-"), "missing", "output");
    const result = await scan(
      fixture,
      "scan",
      "--store",
      join(useTempDir("tasker-scan-modes-store-"), "store.jsonl"),
      "--out",
      out,
    );
    expect(result.code).toBe(0);
    expect(mode(dirname(out))).toBe(0o700);
    expect(mode(out)).toBe(0o700);
    expect(mode(join(out, "records.jsonl"))).toBe(0o600);
  });

  it("leaves transcripts and store unchanged", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone });
    const store = join(useTempDir("tasker-scan-store-stable-"), "store.jsonl");
    const storeContent = `${JSON.stringify(sampleRecord("previous"))}\n`;
    writeFileWithParents(store, storeContent);
    const before = treeSnapshot(join(fixture.home, ".claude"));
    const result = await scan(fixture, "scan", "--store", store, "--out", useTempDir("tasker-scan-stable-out-"));
    expect(result.code).toBe(0);
    expect(treeSnapshot(join(fixture.home, ".claude"))).toEqual(before);
    expect(readFileSync(store, "utf8")).toBe(storeContent);
  });

  const tokenCases: [string, string][] = [
    ["ghp prefix", secret("ghp_", "a".repeat(36))],
    ["gho prefix", secret("gho_", "b".repeat(36))],
    ["ghu prefix", secret("ghu_", "c".repeat(36))],
    ["ghs prefix", secret("ghs_", "d".repeat(36))],
    ["ghr prefix", secret("ghr_", "e".repeat(36))],
    ["github_pat prefix", secret("github_pat_", "f".repeat(22))],
    ["sk ant prefix", secret("sk-ant-", "g".repeat(20))],
    ["sk or prefix", secret("sk-or-", "h".repeat(20))],
    ["sk proj prefix", secret("sk-proj-", "i".repeat(20))],
    ["sk svcacct prefix", secret("sk-svcacct-", "j".repeat(20))],
    ["sk admin prefix", secret("sk-admin-", "k".repeat(20))],
    ["sk generic prefix", secret("sk-", "l".repeat(32))],
    ["Atlassian prefix", secret("ATATT", "m".repeat(20))],
    ["AWS AKIA prefix", secret("AKIA", "ABCDEFGH12345678")],
    ["AWS ASIA prefix", secret("ASIA", "ABCDEFGH12345678")],
    ["Slack xoxa prefix", secret("xoxa-", "a".repeat(10))],
    ["Slack xoxb prefix", secret("xoxb-", "b".repeat(10))],
    ["Slack xoxe prefix", secret("xoxe-", "c".repeat(10))],
    ["Slack xoxp prefix", secret("xoxp-", "d".repeat(10))],
    ["Slack xoxr prefix", secret("xoxr-", "e".repeat(10))],
    ["Slack xoxs prefix", secret("xoxs-", "f".repeat(10))],
    ["Slack app prefix", secret("xapp-", "g".repeat(10))],
    ["npm prefix", secret("npm_", "h".repeat(36))],
    ["Google prefix", secret("AIza", "i".repeat(35))],
    ["GitLab prefix", secret("glpat-", "j".repeat(20))],
    ["JWT form", secret("eyJhbGciOiJIUzI1NiJ9.", "eyJzdWIiOiIxMjM0NTY3ODkwIn0.", "c2lnbmF0dXJl")],
    ["Bearer form", secret("Bearer ", "K".repeat(8))],
    ["Basic form", secret("Basic ", "B".repeat(8))],
    ["URL password form", secret("https://user:", "p".repeat(8), "@host.test/path")],
    [
      "private key form",
      secret("-----BEGIN RSA PRIVATE KEY-----\n", "synthetic-private-data", "\n-----END RSA PRIVATE KEY-----"),
    ],
    ["TOKEN assignment", secret("ACCESS_TOKEN=", "t".repeat(8))],
    ["SECRET assignment", secret("CLIENT_SECRET: ", "s".repeat(8))],
    ["PASSWORD assignment", secret("PASSWORD=", "p".repeat(8))],
    ["PASSWD assignment", secret("DB_PASSWD=", "w".repeat(8))],
    ["API_KEY assignment", secret("API_KEY=", "k".repeat(8))],
    ["API-KEY assignment", secret("SERVICE_API-KEY: ", "q".repeat(8))],
    ["APIKEY option", secret("--APIKEY ", "v".repeat(8))],
  ];

  it.each(tokenCases)("redacts token form %s", async (_name, value) => {
    const fixture = await useDenialRepo();
    const storeFixture = useStoreFixture(fixture, [sampleRecord("token-case", { assistantText: value })]);
    const result = await runStore(storeFixture, "token-case");
    expect(result.code).toBe(0);
    expect(readFileSync(storeFixture.store, "utf8")).not.toContain(value);
    expect(readFileSync(storeFixture.store, "utf8")).toContain("[redacted]");
  });

  it("redacts every record string and key", async () => {
    const fixture = await useDenialRepo();
    const token = secret("ghp_", "z".repeat(36));
    const storeFixture = useStoreFixture(fixture, [
      sampleRecord("key-redaction", { [token]: token, assistantText: `value ${token}` }),
    ]);
    const result = await runStore(storeFixture, "key-redaction");
    const text = readFileSync(storeFixture.store, "utf8");
    expect(result.code).toBe(0);
    expect(text).not.toContain(token);
    expect(text.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps listed ordinary text", async () => {
    const fixture = await useDenialRepo();
    const ordinary = '$token "$token" [redacted] ordinary token text password example';
    const storeFixture = useStoreFixture(fixture, [sampleRecord("ordinary", { assistantText: ordinary })]);
    const result = await runStore(storeFixture, "ordinary");
    const stored = JSON.parse(readFileSync(storeFixture.store, "utf8")) as Record<string, unknown>;
    expect(result.code).toBe(0);
    expect(stored.assistantText).toBe(ordinary);
  });

  it("redacts the quoted JSON api_key value and keeps its punctuation", async () => {
    const fixture = await useDenialRepo();
    const text = '"api_key": "aaaaaaaa"';
    const storeFixture = useStoreFixture(fixture, [sampleRecord("json-key", { assistantText: text })]);
    const result = await runStore(storeFixture, "json-key");
    const stored = JSON.parse(readFileSync(storeFixture.store, "utf8")) as Record<string, unknown>;
    expect(result.code).toBe(0);
    expect(stored.assistantText).toBe('"api_key": "[redacted]"');
  });

  it("redaction is stable", async () => {
    const fixture = await useDenialRepo();
    const storeFixture = useStoreFixture(fixture, [sampleRecord("stable", { assistantText: "[redacted] $token" })]);
    const result = await runStore(storeFixture, "stable");
    const stored = JSON.parse(readFileSync(storeFixture.store, "utf8")) as Record<string, unknown>;
    expect(result.code).toBe(0);
    expect(stored.assistantText).toBe("[redacted] $token");
  });

  it("merges redacted write keys", async () => {
    const fixture = await useDenialRepo();
    const first = secret("ghp_", "a".repeat(36));
    const second = secret("ghp_", "b".repeat(36));
    const storeFixture = useStoreFixture(fixture, [
      sampleRecord("merge", {
        comparison: { form: {}, writeKeys: { [first]: { "allow/-": 2 }, [second]: { "reject/classifier": 3 } } },
      }),
    ]);
    const result = await runStore(storeFixture, "merge");
    const stored = JSON.parse(readFileSync(storeFixture.store, "utf8")) as Record<string, unknown>;
    expect(result.code).toBe(0);
    expect((stored.comparison as { writeKeys: Record<string, Record<string, number>> }).writeKeys).toEqual({
      "[redacted]": { "allow/-": 2, "reject/classifier": 3 },
    });
  });

  it("reports every invalid selected ID before writes", async () => {
    const fixture = await useDenialRepo();
    const storeFixture = useStoreFixture(fixture, [sampleRecord("valid")]);
    const before = treeSnapshot(storeFixture.out);
    const result = await runStore(storeFixture, "valid", "bad/id", "missing-one", "missing-two");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("bad/id");
    expect(result.stderr).toContain("missing-one");
    expect(result.stderr).toContain("missing-two");
    expect(existsSync(storeFixture.store)).toBe(false);
    expect(treeSnapshot(storeFixture.out)).toEqual(before);
  });

  it("checks schema and required keys before store writes", async () => {
    const fixture = await useDenialRepo();
    const storeFixture = useStoreFixture(fixture, [sampleRecord("wrong-schema"), sampleRecord("missing-key")]);
    const path = join(storeFixture.out, "records.jsonl");
    writeFileWithParents(
      path,
      `${JSON.stringify(sampleRecord("wrong-schema", { schema: 2 }))}\n${JSON.stringify({ id: "missing-key" })}\n`,
    );
    const result = await runStore(storeFixture, "wrong-schema", "missing-key");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("wrong-schema");
    expect(result.stderr).toContain("missing-key");
    expect(existsSync(storeFixture.store)).toBe(false);
  });

  it("accepts repeated requested IDs once", async () => {
    const fixture = await useDenialRepo();
    const storeFixture = useStoreFixture(fixture, [sampleRecord("same")]);
    const result = await runStore(storeFixture, "same", "same");
    expect(result.code).toBe(0);
    expect(readFileSync(storeFixture.store, "utf8").trim().split("\n")).toHaveLength(1);
    expect(result.stdout).toContain("1 stored");
  });

  it("reports already stored IDs", async () => {
    const fixture = await useDenialRepo();
    const storeFixture = useStoreFixture(
      fixture,
      [sampleRecord("present")],
      `${JSON.stringify(sampleRecord("present"))}\n`,
    );
    const result = await runStore(storeFixture, "present");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("present already stored");
  });

  it("appends selected records in argument order", async () => {
    const fixture = await useDenialRepo();
    const storeFixture = useStoreFixture(fixture, [
      sampleRecord("first"),
      sampleRecord("second"),
      sampleRecord("third"),
    ]);
    const result = await runStore(storeFixture, "third", "second", "first");
    const lines = readFileSync(storeFixture.store, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(result.code).toBe(0);
    expect(lines.map((record) => record.id)).toEqual(["third", "second", "first"]);
    expect(result.stdout).toContain("3 stored");
  });

  it("repairs a missing final newline", async () => {
    const fixture = await useDenialRepo();
    const storeFixture = useStoreFixture(fixture, [sampleRecord("new")]);
    writeFileWithParents(storeFixture.store, JSON.stringify(sampleRecord("old")));
    const result = await runStore(storeFixture, "new");
    const text = readFileSync(storeFixture.store, "utf8");
    expect(result.code).toBe(0);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("sets only missing store folder modes", async () => {
    const fixture = await useDenialRepo();
    const storeFixture = useStoreFixture(fixture, [sampleRecord("new")]);
    const base = dirname(dirname(storeFixture.store));
    chmodSync(base, 0o755);
    const result = await runStore(storeFixture, "new");
    expect(result.code).toBe(0);
    expect(mode(base)).toBe(0o755);
    expect(mode(dirname(storeFixture.store))).toBe(0o700);
    expect(mode(storeFixture.store)).toBe(0o600);
  });

  it("redacts an edited scan line again", async () => {
    const fixture = await useDenialRepo();
    writeTranscript(fixture.home, { cwd: fixture.clone, toolUseId: "edited" });
    const out = useTempDir("tasker-edit-scan-out-");
    const store = join(useTempDir("tasker-edit-scan-store-"), "store.jsonl");
    const scanResult = await scan(fixture, "scan", "--store", store, "--out", out);
    expect(scanResult.code).toBe(0);
    const token = secret("sk-admin-", "x".repeat(20));
    const path = join(out, "records.jsonl");
    const record = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    record.assistantText = token;
    writeFileWithParents(path, `${JSON.stringify(record)}\n`);
    const selectedFixture: StoreFixture = { ...fixture, out, store };
    const result = await runStore(selectedFixture, "edited");
    const stored = JSON.parse(readFileSync(store, "utf8")) as Record<string, unknown>;
    expect(result.code).toBe(0);
    expect(stored.id).toBe("edited");
    expect(stored.assistantText).toBe("[redacted]");
  });
});
