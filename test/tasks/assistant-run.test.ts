import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AssistantEvent } from "../../src/assistant/provider.js";
import { dataRootLayout, taskSessionsDir } from "../../src/store/layout.js";
import { readTurnResult, turnResultJsonSchema } from "../../src/plan/turn-result.js";
import type { Task } from "../../src/store/store.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { vcsForRepo } from "../../src/vcs/provider.js";
import {
  type AssistantSessionRequest,
  executeReadDenyPaths,
  prepareTaskExecuteRun,
  prepareTaskPlanModeRun,
  type RepoReadDenyPaths,
} from "../../src/tasks/assistant-run.js";
import { TEST_EXECUTE_SESSION_ID, TEST_SESSION_ID, claudeOverageEvent, claudeSample } from "../helpers/fake-claude.js";
import { turnResultStream } from "../helpers/plan.js";
import { readRunMarker, withDataRootStore } from "../helpers/store.js";
import { type AssistantRunFixture, useAssistantRunFixture } from "../helpers/task-fixtures.js";
import { useTempDir } from "../helpers/temp.js";

// The arguments of argv that follow flag, up to the next flag.
function flagValues(argv: string[], flag: string): string[] | undefined {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  const rest = argv.slice(at + 1);
  const next = rest.findIndex((arg) => arg.startsWith("--"));
  return next === -1 ? rest : rest.slice(0, next);
}

// The one fake repo of most deny-list tests. None of its paths exists on disk, and each still goes in the list.
const ONE_REPO: readonly RepoReadDenyPaths[] = [{ denyReadPaths: ["/k/id"], publishTokensPath: "/p" }];

// The call helper of executeReadDenyPaths().
const denyPaths = (env: NodeJS.ProcessEnv, repos: readonly RepoReadDenyPaths[] = ONE_REPO) =>
  executeReadDenyPaths({ env, repos });

// The models of the task repo in the configuration of a fixture.
const modelsOf = (fixture: AssistantRunFixture) => fixture.config.repos[fixture.started.repoKey]!.assistant.models;

// The call helper of prepareTaskPlanModeRun(). The test builds the fixture, so that it can still read the
// fake claude when the prepare throws. task changes the task of the fixture, for example to drop its worktree.
const runPlanMode = async (
  fixture: AssistantRunFixture,
  options: {
    role?: "plan" | "review";
    session?: AssistantSessionRequest;
    task?: (task: Task) => Task;
    jsonSchema?: Record<string, unknown>;
    approvedResetsAt?: number;
  } = {},
) => {
  const { config, env, started } = fixture;
  const task = options.task ? options.task(fixture.task) : fixture.task;
  const events: AssistantEvent[] = [];
  return withDataRootStore(started.dataRoot, async (store) => {
    const prepared = await prepareTaskPlanModeRun({
      config,
      store,
      task,
      role: options.role ?? "plan",
      session: options.session ?? { resume: false },
      env,
      approvedResetsAt: options.approvedResetsAt,
    });
    const outcome = await prepared.start({
      prompt: "p",
      jsonSchema: options.jsonSchema,
      onEvent: (e) => events.push(e),
    });
    return { prepared, outcome, events };
  });
};

type ExecuteStart = Parameters<Awaited<ReturnType<typeof prepareTaskExecuteRun>>["start"]>[0];

// The call helper of prepareTaskExecuteRun(): the fixture in the executing state, the prepare, the starts
// (one start { prompt: "p" } unless run.starts gives others), and the surface of the task repo.
// run.session changes the session request, and run.env edits the env of the fixture.
const prepareAndStartExecute = async (
  options: Parameters<typeof useAssistantRunFixture>[0],
  run: {
    session?: AssistantSessionRequest;
    env?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
    starts?: ExecuteStart[];
  } = {},
) => {
  const fixture = await useAssistantRunFixture({ state: "executing", ...options });
  const { config, task, started } = fixture;
  const env = run.env ? run.env({ ...fixture.env }) : fixture.env;
  const result = await withDataRootStore(started.dataRoot, async (store) => {
    const prepared = await prepareTaskExecuteRun({
      config,
      store,
      task,
      session: run.session ?? { resume: false },
      env,
    });
    const outcomes = [];
    for (const input of run.starts ?? [{ prompt: "p" }]) outcomes.push(await prepared.start(input));
    return { prepared, outcomes, outcome: outcomes[0]! };
  });
  const { vcs, ctx } = vcsForRepo(config, started.repoKey, env);
  return { ...fixture, env, ...result, surface: vcs.assistantSurface(ctx), models: modelsOf(fixture) };
};

describe("executeReadDenyPaths", () => {
  it("gives the keys of every repo first and the publish tokens of every repo after the env paths", () => {
    expect(
      denyPaths({ HOME: "/h", TASKER_CONFIG: "/t/config.json" }, [
        { denyReadPaths: ["/k/a"], publishTokensPath: "/p/a" },
        { denyReadPaths: ["/k/b"], publishTokensPath: "/p/b" },
      ]),
    ).toEqual([
      "/k/a",
      "/k/b",
      "/h/.ssh",
      "/h/.config/gh",
      "/h/.git-credentials",
      "/h/.netrc",
      "/h/.claude/.credentials.json",
      "/p/a",
      "/p/b",
      "/t/config.json",
    ]);
  });

  it("gives the paths in a fixed order", () => {
    expect(denyPaths({ HOME: "/h", XDG_CONFIG_HOME: "/x", TASKER_CONFIG: "/t/config.json" })).toEqual([
      "/k/id",
      "/h/.ssh",
      "/x/gh",
      "/h/.git-credentials",
      "/h/.netrc",
      "/h/.claude/.credentials.json",
      "/p",
      "/t/config.json",
    ]);
  });

  it("takes the gh folder from GH_CONFIG_DIR, then XDG_CONFIG_HOME, then HOME", () => {
    const ghEntry = (env: NodeJS.ProcessEnv) => denyPaths(env)[2];
    expect(ghEntry({ HOME: "/h", XDG_CONFIG_HOME: "/x", GH_CONFIG_DIR: "/g" })).toBe("/g");
    expect(ghEntry({ HOME: "/h", XDG_CONFIG_HOME: "/x" })).toBe("/x/gh");
    expect(ghEntry({ HOME: "/h" })).toBe("/h/.config/gh");
  });

  it("takes the credentials of Claude Code from CLAUDE_CONFIG_DIR", () => {
    const paths = denyPaths({ HOME: "/h", CLAUDE_CONFIG_DIR: "/c" });
    expect(paths).toContain("/c/.credentials.json");
    expect(paths).not.toContain("/h/.claude/.credentials.json");
  });

  it("gives only the surface paths and the publish tokens when the env names no folder", () => {
    expect(denyPaths({})).toEqual(["/k/id", "/p"]);
  });

  it("gives the gh folder and the configuration of XDG_CONFIG_HOME when HOME is unset", () => {
    expect(denyPaths({ XDG_CONFIG_HOME: "/x" })).toEqual(["/k/id", "/x/gh", "/p", "/x/tasker/config.json"]);
  });

  it("counts a blank HOME as unset", () => {
    expect(denyPaths({ HOME: "  " })).toEqual(["/k/id", "/p"]);
  });

  it("makes a relative path from the env absolute, against the cwd of tasker", () => {
    const paths = denyPaths({ TASKER_CONFIG: "rel/tasker.json", GH_CONFIG_DIR: "rel/gh" });

    expect(paths).toContain(resolve(process.cwd(), "rel/gh"));
    expect(paths).toContain(resolve(process.cwd(), "rel/tasker.json"));
    expect(paths).not.toContain("rel/gh");
    expect(paths).not.toContain("rel/tasker.json");
  });

  it("gives the default configuration file under HOME", () => {
    expect(denyPaths({ HOME: "/h" }).at(-1)).toBe("/h/.config/tasker/config.json");
  });
});

describe("prepareTaskPlanModeRun", () => {
  const schema = { type: "object" };

  it("runs the assistant in the plan mode with the plan model and no other limit", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("json-schema") } });
    const { claude, config, task, started } = fixture;
    const models = modelsOf(fixture);
    const { prepared, outcome, events } = await runPlanMode(fixture, { jsonSchema: schema });

    expect(outcome.kind).toBe("success");
    const call = claude.calls()[0]!;
    expect(flagValues(call.argv, "--session-id")).toEqual([prepared.sessionId]);
    expect(prepared.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(flagValues(call.argv, "--model")).toEqual([models.plan.model]);
    expect(flagValues(call.argv, "--effort")).toEqual([models.plan.effort]);
    expect(flagValues(call.argv, "--permission-mode")).toEqual(["plan"]);
    expect(flagValues(call.argv, "--json-schema")).toEqual([JSON.stringify(schema)]);
    expect(flagValues(call.argv, "--disallowedTools")).toEqual(["Bash(git push:*)"]);
    expect(call.argv).not.toContain("--allowedTools");
    expect(call.argv).not.toContain("--settings");
    expect(call.envNames).not.toContain("GH_TOKEN");
    expect(call.envNames).not.toContain("SSH_AUTH_SOCK");
    expect(existsSync(taskSessionsDir(config.dataRoot, task))).toBe(true);
    expect(readRunMarker(dataRootLayout(started.dataRoot).database, task.id)?.child_pid).toBeGreaterThan(0);
    expect(events).toEqual(outcome.kind === "success" ? outcome.events : []);
    expect(events.length).toBeGreaterThan(0);
    expect(prepared.session).toEqual({
      repoKey: started.repoKey,
      provider: "claude-code",
      model: models.plan.model,
      effort: models.plan.effort,
    });
    expect(prepared).not.toHaveProperty("executeCommitText");
  });

  it("runs the review role with the review model and the same limits", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("json-schema") } });
    const models = modelsOf(fixture);
    await runPlanMode(fixture, { role: "review", jsonSchema: schema });
    const { claude } = fixture;

    const call = claude.calls()[0]!;
    expect(flagValues(call.argv, "--model")).toEqual([models.review.model]);
    expect(flagValues(call.argv, "--effort")).toEqual([models.review.effort]);
    expect(flagValues(call.argv, "--permission-mode")).toEqual(["plan"]);
    expect(flagValues(call.argv, "--disallowedTools")).toEqual(["Bash(git push:*)"]);
    expect(call.argv).not.toContain("--allowedTools");
    expect(call.argv).not.toContain("--settings");
  });

  it("refuses a task that has no worktree, and starts no child", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("json-schema") } });

    await expect(runPlanMode(fixture, { task: (t) => ({ ...t, worktreePath: null }) })).rejects.toThrow(
      `task ${fixture.task.id}`,
    );
    expect(fixture.claude.calls()).toEqual([]);
  });

  it("stops the run at the plan deadline", async () => {
    const fixture = await useAssistantRunFixture({
      claude: { stream: claudeSample("json-schema"), untilStopped: true },
      limits: { planTimeoutMin: 0.001 },
    });
    const { outcome } = await runPlanMode(fixture, { jsonSchema: schema });

    expect(outcome.kind).toBe("timeout");
  });

  it("continues a recorded session with its recorded model and effort, not the configured ones", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("resume") } });
    const { started, claude } = fixture;
    const recorded = { repoKey: started.repoKey, provider: "claude-code", model: "haiku", effort: "low" } as const;
    expect(modelsOf(fixture).plan).not.toMatchObject({ model: "haiku" });

    const { prepared } = await runPlanMode(fixture, {
      session: { resume: true, sessionId: TEST_SESSION_ID, recorded },
    });

    const { argv } = claude.calls()[0]!;
    expect(prepared.sessionId).toBe(TEST_SESSION_ID);
    expect(flagValues(argv, "--resume")).toEqual([TEST_SESSION_ID]);
    expect(argv).not.toContain("--session-id");
    expect(flagValues(argv, "--model")).toEqual(["haiku"]);
    expect(flagValues(argv, "--effort")).toEqual(["low"]);
    expect(prepared.session).toEqual(recorded);
  });
});

describe("prepareTaskPlanModeRun with an overage event", () => {
  const overage = claudeOverageEvent();
  const resetsAt = (overage["rate_limit_info"] as { resetsAt: number }).resetsAt;
  const withOverage = () => [JSON.stringify(overage), ...claudeSample("plain")];

  it("stops the run at paid usage under the decline policy", async () => {
    // The short deadline ends the child at once when the stop does not work.
    const fixture = await useAssistantRunFixture({
      claude: { stream: [JSON.stringify(overage)], untilStopped: true },
      limits: { planTimeoutMin: 0.01 },
    });
    const { outcome } = await runPlanMode(fixture);

    expect(outcome).toMatchObject({ kind: "quota", cause: "overage", resetsAt });
  });

  it("does not stop the run under the ask policy, also when a window is approved", async () => {
    const fixture = await useAssistantRunFixture({
      claude: { stream: withOverage() },
      repo: { overagePolicy: "ask" },
    });
    const { outcome } = await runPlanMode(fixture, { approvedResetsAt: resetsAt });

    expect(outcome.kind).toBe("success");
  });

  it("does not stop the run when the approved window is the window of the event", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: withOverage() } });
    const { outcome } = await runPlanMode(fixture, { approvedResetsAt: resetsAt });

    expect(outcome.kind).toBe("success");
  });
});

describe("prepareTaskExecuteRun", () => {
  // The rule form of claude: // marks an absolute path. It is computed here, apart from the code under test.
  const expectedRule = (tool: string, path: string) => `${tool}(/${path})`;

  it("runs the assistant under dontAsk with the execute model and the file tools of the worktree", async () => {
    const { claude, models, started } = await prepareAndStartExecute({ claude: { stream: claudeSample("plain") } });

    const { argv } = claude.calls()[0]!;
    const wt = started.worktree;
    expect(flagValues(argv, "--permission-mode")).toEqual(["dontAsk"]);
    expect(flagValues(argv, "--model")).toEqual([models.execute.model]);
    expect(flagValues(argv, "--effort")).toEqual([models.execute.effort]);
    expect(argv).not.toContain("--json-schema");
    expect(flagValues(argv, "--allowedTools")).toEqual([
      expectedRule("Read", `${wt}/**`),
      expectedRule("Glob", `${wt}/**`),
      expectedRule("Grep", `${wt}/**`),
      expectedRule("Edit", `${wt}/**`),
      expectedRule("Write", `${wt}/**`),
      "Bash",
    ]);
    expect(flagValues(argv, "--disallowedTools")).toEqual([
      "Bash(git push:*)",
      ...["Edit", "Write"].flatMap((tool) => [
        expectedRule(tool, `${wt}/.git`),
        expectedRule(tool, `${wt}/.git/**`),
        expectedRule(tool, `${started.clone}/**`),
      ]),
    ]);
  });

  it("runs the shell in the sandbox with the write paths and the read deny list", async () => {
    const { claude, env, started, surface } = await prepareAndStartExecute({ claude: { stream: claudeSample("plain") } });

    expect(claude.calls()[0]!.settings).toMatchObject({
      sandbox: {
        filesystem: {
          allowWrite: await surface.sandboxWritePaths(started.worktree),
          denyRead: denyPaths(env, [surface]),
        },
      },
    });
  });

  it("denies the ssh keys and the publish tokens of every configured repo in the shell", async () => {
    const keys = useTempDir("tasker-keys-");
    const { claude, started } = await prepareAndStartExecute({
      claude: { stream: claudeSample("plain") },
      sshKey: join(keys, "a_key"),
      otherRepo: { key: "codeguru42/other", sshKey: join(keys, "b_key") },
    });

    const denyRead = (claude.calls()[0]!.settings as { sandbox: { filesystem: { denyRead: string[] } } }).sandbox
      .filesystem.denyRead;
    expect(denyRead).toEqual(
      expect.arrayContaining([
        join(keys, "a_key"),
        join(keys, "b_key"),
        repoPaths(started.dataRoot, started.repoKey).publishTokens,
        repoPaths(started.dataRoot, "codeguru42/other").publishTokens,
      ]),
    );
  });

  it("gives the commit text of the surface", async () => {
    const { prepared, surface } = await prepareAndStartExecute({ claude: { stream: claudeSample("plain") } });

    expect(prepared.executeCommitText).toBe(surface.executeCommitText);
  });

  it("passes the JSON Schema of a start, and the structured output reads as a turn result", async () => {
    const jsonSchema = turnResultJsonSchema();

    const { claude, outcome } = await prepareAndStartExecute(
      { claude: { stream: turnResultStream("done") } },
      { starts: [{ prompt: "p", jsonSchema }] },
    );

    expect(flagValues(claude.calls()[0]!.argv, "--json-schema")).toEqual([JSON.stringify(jsonSchema)]);
    expect(outcome.kind).toBe("success");
    expect(readTurnResult(outcome.kind === "success" ? outcome.structuredOutput : undefined)).toEqual({ kind: "done" });
  });

  it("stops the run at the execute deadline, not the plan deadline", async () => {
    const { outcome } = await prepareAndStartExecute({
      claude: { stream: claudeSample("plain"), untilStopped: true },
      limits: { executeTimeoutMin: 0.001, planTimeoutMin: 60 },
    });

    expect(outcome.kind).toBe("timeout");
  });

  it("stops a start at its own timeoutMs, not at the execute deadline", async () => {
    const { outcome } = await prepareAndStartExecute(
      { claude: { stream: claudeSample("plain"), untilStopped: true }, limits: { executeTimeoutMin: 60 } },
      { starts: [{ prompt: "p", timeoutMs: 50 }] },
    );

    expect(outcome.kind).toBe("timeout");
  });

  it("starts a new session with --session-id and continues it with --resume on a later start", async () => {
    const { claude, prepared } = await prepareAndStartExecute(
      { claude: { stream: claudeSample("plain") } },
      { starts: [{ prompt: "p" }, { prompt: "q" }] },
    );

    const [first, second] = claude.calls();
    expect(flagValues(first!.argv, "--session-id")).toEqual([prepared.sessionId]);
    expect(first!.argv).not.toContain("--resume");
    expect(flagValues(second!.argv, "--resume")).toEqual([prepared.sessionId]);
    expect(second!.argv).not.toContain("--session-id");
  });

  it("continues a recorded session with --resume on every start", async () => {
    const recorded = { repoKey: "codeguru42/tasker", provider: "claude-code", model: "haiku", effort: "low" } as const;

    const { claude } = await prepareAndStartExecute(
      { claude: { stream: claudeSample("plain") } },
      {
        session: { resume: true, sessionId: TEST_EXECUTE_SESSION_ID, recorded },
        starts: [{ prompt: "p" }, { prompt: "q" }],
      },
    );

    expect(claude.calls()).toHaveLength(2);
    for (const { argv } of claude.calls()) {
      expect(flagValues(argv, "--resume")).toEqual([TEST_EXECUTE_SESSION_ID]);
      expect(argv).not.toContain("--session-id");
    }
  });
});
