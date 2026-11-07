import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { permissionHookSettings } from "../../src/assistant/claude-code/permission-hook.js";
import type { Config } from "../../src/config/schema.js";
import type { AssistantEvent } from "../../src/assistant/provider.js";
import { dataRootLayout, taskSessionsDir } from "../../src/store/layout.js";
import { readTurnResult, turnResultJsonSchema } from "../../src/plan/turn-result.js";
import type { Task, TaskStore } from "../../src/store/store.js";
import type { RunInput } from "../../src/assistant/provider.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { type AssistantSurface, vcsForRepo } from "../../src/vcs/provider.js";
import {
  type AssistantSessionRequest,
  sandboxReadDenyPaths,
  prepareTaskExecuteRun,
  prepareTaskPlanModeRun,
  type PreparedExecuteRun,
  type RepoReadDenyPaths,
} from "../../src/tasks/assistant-run.js";
import {
  TEST_EXECUTE_SESSION_ID,
  TEST_SESSION_ID,
  claudeOverageEvent,
  claudeRateLimitEvent,
  claudeSample,
  claudeSampleEvents,
  type FakeClaudeControl,
  withEventFirst,
} from "../helpers/fake-claude.js";
import {
  CODEX_PLAIN_USAGE,
  CODEX_RESUME_USAGE,
  CODEX_THREAD_ID,
  codexSample,
  useFakeCodexRun,
} from "../helpers/fake-codex.js";
import { seedPlanSession, turnResultStream } from "../helpers/plan.js";
import {
  databasePathOf,
  NO_SESSION_VALUES,
  quotaEventsOf,
  readRunMarker,
  sessionValuesOf,
  withDataRootStore,
} from "../helpers/store.js";
import { type AssistantRunFixture, useAssistantRunFixture } from "../helpers/task-fixtures.js";
import { useTempDir } from "../helpers/temp.js";

// The codex edit hook script has no built file under vitest, so the execute role of codex would refuse to run.
vi.mock("../../src/assistant/codex/edit-hook.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/assistant/codex/edit-hook.js")>()),
  EDIT_HOOK_SCRIPT: process.execPath,
}));

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

// The call helper of sandboxReadDenyPaths().
const denyPaths = (env: NodeJS.ProcessEnv, repos: readonly RepoReadDenyPaths[] = ONE_REPO) =>
  sandboxReadDenyPaths({ env, repos });

// The assistant surface of the task repo of a fixture.
const surfaceOf = (fixture: Pick<AssistantRunFixture, "config" | "started">, env: NodeJS.ProcessEnv) => {
  const { vcs, ctx } = vcsForRepo(fixture.config, fixture.started.repoKey, env);
  return vcs.assistantSurface(ctx);
};

// Expects that the settings of a run hold the sandbox with the write paths and the read deny list of the surface.
const expectTaskSandbox = async (
  settings: unknown,
  surface: AssistantSurface,
  worktree: string,
  env: NodeJS.ProcessEnv,
) => {
  expect(settings).toMatchObject({
    sandbox: {
      filesystem: {
        allowWrite: await surface.sandboxWritePaths(worktree),
        denyRead: denyPaths(env, [surface]),
      },
    },
  });
};

// The models of the task repo in the configuration of a fixture.
const modelsOf = (fixture: AssistantRunFixture) => fixture.config.repos[fixture.started.repoKey].assistant.models;

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
    runConfig?: Config;
    runEnv?: NodeJS.ProcessEnv;
    beforeStart?: (prepared: Awaited<ReturnType<typeof prepareTaskPlanModeRun>>) => void;
  } = {},
) => {
  const { started } = fixture;
  const config = options.runConfig ?? fixture.config;
  const env = options.runEnv ?? fixture.env;
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
    options.beforeStart?.(prepared);
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
// run.codex makes a fake codex, puts it first on PATH and sets the provider of the task repo to codex.
// run.beforeStart runs after the prepare and before the first start, for example to record the session row.
const prepareAndStartExecute = async (
  options: Parameters<typeof useAssistantRunFixture>[0],
  run: {
    session?: AssistantSessionRequest;
    env?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
    starts?: ExecuteStart[];
    approvedResetsAt?: number;
    codex?: FakeClaudeControl;
    beforeStart?: (store: TaskStore, prepared: PreparedExecuteRun) => void;
  } = {},
) => {
  const fixture = await useAssistantRunFixture({ state: "executing", ...options });
  const { task, started } = fixture;
  const codex = run.codex ? useFakeCodexRun(run.codex) : undefined;
  const taskRepo = fixture.config.repos[started.repoKey];
  const config = codex
    ? {
        ...fixture.config,
        repos: {
          ...fixture.config.repos,
          [started.repoKey]: { ...taskRepo, assistant: { ...taskRepo.assistant, provider: "codex" as const } },
        },
      }
    : fixture.config;
  const baseEnv = codex ? { ...fixture.env, PATH: [codex.binDir, fixture.env.PATH].join(delimiter) } : fixture.env;
  const env = run.env ? run.env({ ...baseEnv }) : baseEnv;
  const result = await withDataRootStore(started.dataRoot, async (store) => {
    const prepared = await prepareTaskExecuteRun({
      config,
      store,
      task,
      session: run.session ?? { resume: false },
      env,
      approvedResetsAt: run.approvedResetsAt,
    });
    run.beforeStart?.(store, prepared);
    const outcomes = [];
    for (const input of run.starts ?? [{ prompt: "p" }]) outcomes.push(await prepared.start(input));
    return { prepared, outcomes, outcome: outcomes[0] };
  });
  return {
    ...fixture,
    config,
    codex,
    env,
    ...result,
    surface: surfaceOf({ ...fixture, config }, env),
    models: modelsOf(fixture),
  };
};

describe("sandboxReadDenyPaths", () => {
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
      "/h/.codex/auth.json",
      "/h/.pi/agent/auth.json",
      "/h/.pi/agent/mcp-auth.json",
      "/h/.pi/agent/models.json",
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
      "/h/.codex/auth.json",
      "/h/.pi/agent/auth.json",
      "/h/.pi/agent/mcp-auth.json",
      "/h/.pi/agent/models.json",
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

  it("takes the credentials of Codex from CODEX_HOME", () => {
    const paths = denyPaths({ HOME: "/h", CODEX_HOME: "/cx" });
    expect(paths).toContain("/cx/auth.json");
    expect(paths).not.toContain("/h/.codex/auth.json");
  });

  it("takes the credentials of Codex from .codex under HOME", () => {
    expect(denyPaths({ HOME: "/h" })).toContain("/h/.codex/auth.json");
  });

  it("takes the credentials of pi from TASKER_PI_CODING_AGENT_DIR", () => {
    expect(denyPaths({ HOME: "/h", TASKER_PI_CODING_AGENT_DIR: "/pi/custom" })).toEqual([
      "/k/id",
      "/h/.ssh",
      "/h/.config/gh",
      "/h/.git-credentials",
      "/h/.netrc",
      "/h/.claude/.credentials.json",
      "/h/.codex/auth.json",
      "/pi/custom/auth.json",
      "/pi/custom/mcp-auth.json",
      "/pi/custom/models.json",
      "/h/.pi/agent/auth.json",
      "/h/.pi/agent/mcp-auth.json",
      "/h/.pi/agent/models.json",
      "/p",
      "/h/.config/tasker/config.json",
    ]);
  });

  it.each([
    ["HOME default", { HOME: "/h" }, ["/h/.pi/agent"]],
    ["PI_CODING_AGENT_DIR", { HOME: "/h", PI_CODING_AGENT_DIR: "/u" }, ["/u", "/h/.pi/agent"]],
    ["tilde path", { HOME: "/h", PI_CODING_AGENT_DIR: "~/u" }, ["/h/u", "/h/.pi/agent"]],
    ["file URL", { HOME: "/h", PI_CODING_AGENT_DIR: "file:///u" }, ["/u", "/h/.pi/agent"]],
    ["relative PI path", { HOME: "/h", PI_CODING_AGENT_DIR: "rel/u" }, ["/h/.pi/agent"]],
    ["file URL with host", { HOME: "/h", PI_CODING_AGENT_DIR: "file://host/u" }, ["/h/.pi/agent"]],
    ["blank PI path", { HOME: "/h", PI_CODING_AGENT_DIR: " " }, ["/h/.pi/agent"]],
    ["duplicate HOME path", { HOME: "/h", PI_CODING_AGENT_DIR: "/h/.pi/agent" }, ["/h/.pi/agent"]],
    ["Tasker source", { HOME: "/h", TASKER_PI_CODING_AGENT_DIR: "/p" }, ["/p", "/h/.pi/agent"]],
    [
      "all sources",
      { HOME: "/h", TASKER_PI_CODING_AGENT_DIR: "/p", PI_CODING_AGENT_DIR: "/u" },
      ["/p", "/u", "/h/.pi/agent"],
    ],
    [
      "duplicate sources",
      { HOME: "/h", TASKER_PI_CODING_AGENT_DIR: "/p", PI_CODING_AGENT_DIR: "/p" },
      ["/p", "/h/.pi/agent"],
    ],
    [
      "relative Tasker source",
      { HOME: "/h", TASKER_PI_CODING_AGENT_DIR: "rel/p", PI_CODING_AGENT_DIR: "/u" },
      ["/u", "/h/.pi/agent"],
    ],
    ["no HOME", { PI_CODING_AGENT_DIR: "/u" }, ["/u"]],
    ["tilde without HOME", { PI_CODING_AGENT_DIR: "~/u" }, []],
    ["relative HOME", { HOME: "rel/h" }, []],
    [
      "relative HOME with Tasker source",
      { HOME: "rel/h", TASKER_PI_CODING_AGENT_DIR: "/p", PI_CODING_AGENT_DIR: "~/u" },
      ["/p"],
    ],
  ] as const)("denies pi files in order for %s", (_name, env, folders) => {
    const paths = denyPaths(env);
    const expected = folders.flatMap((folder) => [
      `${folder}/auth.json`,
      `${folder}/mcp-auth.json`,
      `${folder}/models.json`,
    ]);
    expect(
      paths.filter(
        (path) =>
          !path.includes("/.codex/") &&
          ["auth.json", "mcp-auth.json", "models.json"].some((file) => path.endsWith(`/${file}`)),
      ),
    ).toEqual(expected);
    for (const path of expected) expect(paths.filter((item) => item === path)).toHaveLength(1);
  });

  it.each(["rel/pi", "~user/x", "file://host/x"])(
    "gives no pi entries for a non-absolute TASKER_PI_CODING_AGENT_DIR value: %s",
    (folder) => {
      expect(denyPaths({ TASKER_PI_CODING_AGENT_DIR: folder })).toEqual(["/k/id", "/p"]);
    },
  );

  it("gives the credentials of Codex when only CODEX_HOME is set", () => {
    expect(denyPaths({ CODEX_HOME: "/cx" })).toEqual(["/k/id", "/cx/auth.json", "/p"]);
  });

  it("counts a blank CODEX_HOME as unset", () => {
    const paths = denyPaths({ HOME: "/h", CODEX_HOME: "  " });
    expect(paths).toContain("/h/.codex/auth.json");
    expect(paths.some((path) => path.endsWith("  /auth.json"))).toBe(false);
  });

  it("gives no Codex entry when CODEX_HOME and HOME are blank", () => {
    expect(denyPaths({ HOME: "  ", CODEX_HOME: "  " })).toEqual(["/k/id", "/p"]);
  });

  it("gives no Codex entry when CODEX_HOME and HOME are unset", () => {
    expect(denyPaths({}).some((path) => path.endsWith("auth.json"))).toBe(false);
  });

  it("makes a relative CODEX_HOME absolute, against the cwd of tasker", () => {
    const paths = denyPaths({ CODEX_HOME: "rel/codex" });
    expect(paths).toContain(resolve(process.cwd(), "rel/codex/auth.json"));
    expect(paths).not.toContain("rel/codex/auth.json");
  });

  it("gives the credentials of Codex right after those of Claude Code", () => {
    expect(denyPaths({ CLAUDE_CONFIG_DIR: "/c", CODEX_HOME: "/cx" })).toEqual([
      "/k/id",
      "/c/.credentials.json",
      "/cx/auth.json",
      "/p",
    ]);
  });

  it("gives the pi files after the Codex credentials", () => {
    expect(denyPaths({ HOME: "/h", CODEX_HOME: "/cx", TASKER_PI_CODING_AGENT_DIR: "/pi" })).toEqual([
      "/k/id",
      "/h/.ssh",
      "/h/.config/gh",
      "/h/.git-credentials",
      "/h/.netrc",
      "/h/.claude/.credentials.json",
      "/cx/auth.json",
      "/pi/auth.json",
      "/pi/mcp-auth.json",
      "/pi/models.json",
      "/h/.pi/agent/auth.json",
      "/h/.pi/agent/mcp-auth.json",
      "/h/.pi/agent/models.json",
      "/p",
      "/h/.config/tasker/config.json",
    ]);
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

  it("runs the assistant in the plan mode with the plan model, the sandbox and the deny rules", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("json-schema") } });
    const { claude, config, task, started } = fixture;
    const models = modelsOf(fixture);
    const { prepared, outcome, events } = await runPlanMode(fixture, { jsonSchema: schema });

    expect(outcome.kind).toBe("success");
    const call = claude.calls()[0];
    expect(flagValues(call.argv, "--session-id")).toEqual([prepared.sessionId]);
    expect(prepared.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(flagValues(call.argv, "--model")).toEqual([models.plan.model]);
    expect(flagValues(call.argv, "--effort")).toEqual([models.plan.effort]);
    expect(flagValues(call.argv, "--permission-mode")).toEqual(["plan"]);
    expect(flagValues(call.argv, "--json-schema")).toEqual([JSON.stringify(schema)]);
    expect(flagValues(call.argv, "--disallowedTools")).toEqual(["Bash(git push:*)", "Bash(herdr:*)"]);
    expect(call.argv).not.toContain("--allowedTools");
    await expectTaskSandbox(call.settings, surfaceOf(fixture, fixture.env), started.worktree, fixture.env);
    expect(call.settings).not.toMatchObject(permissionHookSettings(started.worktree));
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
      trustedExtensions: [],
    });
    expect(prepared).not.toHaveProperty("executeCommitText");
  });

  it("runs the review role with the review model and the same limits", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("json-schema") } });
    const models = modelsOf(fixture);
    await runPlanMode(fixture, { role: "review", jsonSchema: schema });
    const { claude } = fixture;

    const call = claude.calls()[0];
    expect(flagValues(call.argv, "--model")).toEqual([models.review.model]);
    expect(flagValues(call.argv, "--effort")).toEqual([models.review.effort]);
    expect(flagValues(call.argv, "--permission-mode")).toEqual(["plan"]);
    expect(flagValues(call.argv, "--disallowedTools")).toEqual(["Bash(git push:*)", "Bash(herdr:*)"]);
    expect(call.argv).not.toContain("--allowedTools");
    await expectTaskSandbox(call.settings, surfaceOf(fixture, fixture.env), fixture.started.worktree, fixture.env);
    expect(call.settings).not.toMatchObject(permissionHookSettings(fixture.started.worktree));
  });

  it("pins the whole argument list of the plan role", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("json-schema") } });
    const models = modelsOf(fixture);
    const { prepared } = await runPlanMode(fixture, { jsonSchema: schema });

    expect(fixture.claude.calls()[0].argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--session-id",
      prepared.sessionId,
      "--model",
      models.plan.model,
      "--effort",
      models.plan.effort,
      "--json-schema",
      JSON.stringify(schema),
      "--permission-mode",
      "plan",
      "--settings",
      expect.any(String),
      "--disallowedTools",
      "Bash(git push:*)",
      "Bash(herdr:*)",
    ]);
  });

  it("pins the whole argument list of the review role", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("json-schema") } });
    const models = modelsOf(fixture);
    const { prepared } = await runPlanMode(fixture, { role: "review", jsonSchema: schema });

    expect(fixture.claude.calls()[0].argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--session-id",
      prepared.sessionId,
      "--model",
      models.review.model,
      "--effort",
      models.review.effort,
      "--json-schema",
      JSON.stringify(schema),
      "--permission-mode",
      "plan",
      "--settings",
      expect.any(String),
      "--disallowedTools",
      "Bash(git push:*)",
      "Bash(herdr:*)",
    ]);
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
    const recorded = {
      repoKey: started.repoKey,
      provider: "claude-code",
      model: "haiku",
      effort: "low",
      trustedExtensions: [] as string[],
    } as const;
    expect(modelsOf(fixture).plan).not.toMatchObject({ model: "haiku" });

    const { prepared } = await runPlanMode(fixture, {
      session: { resume: true, sessionId: TEST_SESSION_ID, recorded },
    });

    const { argv } = claude.calls()[0];
    expect(prepared.sessionId).toBe(TEST_SESSION_ID);
    expect(flagValues(argv, "--resume")).toEqual([TEST_SESSION_ID]);
    expect(argv).not.toContain("--session-id");
    expect(flagValues(argv, "--model")).toEqual(["haiku"]);
    expect(flagValues(argv, "--effort")).toEqual(["low"]);
    expect(prepared.session).toEqual(recorded);
    expect(prepared.provider.id).toBe("claude-code");
  });

  it("keeps the recorded trusted extension list on a continued run", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("resume") } });
    const trustedExtensions = ["old-package", "builtin:codemode"];
    const recorded = {
      repoKey: fixture.started.repoKey,
      provider: "claude-code",
      model: "haiku",
      effort: "low",
      trustedExtensions,
    } as never;
    const { prepared } = await runPlanMode(fixture, {
      session: { resume: true, sessionId: TEST_SESSION_ID, recorded },
    });
    expect(prepared.session).toMatchObject({ trustedExtensions });
  });

  it("passes the ordered current keys on a new pi run and the union on a continued run", async () => {
    const makeRun = async (continued: boolean) => {
      const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("json-schema") } });
      const agentDir = useTempDir("tasker-pi-trusted-run-");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ extensions: ["current"] }));
      const repo = fixture.config.repos[fixture.started.repoKey];
      const piRepo = {
        ...repo,
        assistant: {
          ...repo.assistant,
          provider: "pi",
          models: {
            ...repo.assistant.models,
            plan: { ...repo.assistant.models.plan, model: "openrouter/auto" },
          },
        },
      };
      const runConfig = {
        ...fixture.config,
        repos: { ...fixture.config.repos, [fixture.started.repoKey]: piRepo },
      } as Config;
      const trustedExtensions = ["old", "builtin:codemode"];
      let captured: RunInput | undefined;
      const recorded = {
        repoKey: fixture.started.repoKey,
        provider: "pi" as const,
        model: "openrouter/auto",
        effort: "high" as const,
        trustedExtensions,
      };
      await runPlanMode(fixture, {
        runConfig,
        runEnv: { ...fixture.env, TASKER_PI_CODING_AGENT_DIR: agentDir },
        session: continued ? { resume: true, sessionId: TEST_SESSION_ID, recorded } : { resume: false },
        beforeStart: (prepared) => {
          prepared.provider.run = async (input) => {
            captured = input;
            return {
              kind: "success",
              sessionId: input.sessionId,
              events: [],
              permissionDenials: [],
              usage: "unavailable",
            };
          };
        },
      });
      return { captured };
    };

    const fresh = await makeRun(false);
    expect(fresh.captured?.trustedExtensions).toEqual([
      "current",
      "builtin:llama.cpp",
      "builtin:codemode",
      "builtin:tool-search",
    ]);
    const continued = await makeRun(true);
    expect(continued.captured?.trustedExtensions).toEqual([
      "old",
      "builtin:codemode",
      "current",
      "builtin:llama.cpp",
      "builtin:tool-search",
    ]);
  });

  it("gives the provider of a new session and the approved window of the request", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("json-schema") } });
    const { prepared } = await runPlanMode(fixture, { approvedResetsAt: 1792206000 });

    expect(prepared.provider.id).toBe("claude-code");
    expect(prepared.approvedResetsAt).toBe(1792206000);
  });

  it("gives no approved window when the request has none", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("json-schema") } });
    const { prepared } = await runPlanMode(fixture);

    expect(prepared.approvedResetsAt).toBeUndefined();
  });
});

describe("prepareTaskPlanModeRun with an overage event", () => {
  const overage = claudeOverageEvent();
  const resetsAt = (overage.rate_limit_info as { resetsAt: number }).resetsAt;
  const withOverage = () => withEventFirst(overage, claudeSample("plain"));

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

  it("gives the provider and the approved window of the request", async () => {
    const { prepared } = await prepareAndStartExecute(
      { claude: { stream: claudeSample("plain") } },
      { approvedResetsAt: 1792206000 },
    );

    expect(prepared.provider.id).toBe("claude-code");
    expect(prepared.approvedResetsAt).toBe(1792206000);
  });

  it("gives no approved window when the request has none", async () => {
    const { prepared } = await prepareAndStartExecute({ claude: { stream: claudeSample("plain") } });

    expect(prepared.approvedResetsAt).toBeUndefined();
  });

  it("runs the assistant in the default mode with the execute model and the file tools of the worktree", async () => {
    const { claude, env, models, started } = await prepareAndStartExecute({
      claude: { stream: claudeSample("plain") },
    });

    const { argv } = claude.calls()[0];
    const wt = started.worktree;
    expect(flagValues(argv, "--permission-mode")).toEqual(["default"]);
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
      "StructuredOutput",
      "Skill",
      "TodoWrite",
      expectedRule("NotebookEdit", `${wt}/**`),
      "Agent",
      "Task",
      expectedRule("Read", `${String(env.HOME)}/.claude/skills/**`),
      expectedRule("Read", `${String(env.HOME)}/.claude/plugins/**`),
    ]);
    expect(flagValues(argv, "--disallowedTools")).toEqual([
      "Bash(git push:*)",
      expectedRule("Edit", `${wt}/.git`),
      expectedRule("Edit", `${wt}/.git/**`),
      expectedRule("Edit", `${started.clone}/**`),
    ]);
  });

  it("pins the whole argument list of the execute role", async () => {
    const { claude, env, models, prepared, started } = await prepareAndStartExecute({
      claude: { stream: claudeSample("plain") },
    });
    const wt = started.worktree;

    expect(claude.calls()[0].argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--session-id",
      prepared.sessionId,
      "--model",
      models.execute.model,
      "--effort",
      models.execute.effort,
      "--permission-mode",
      "default",
      "--settings",
      expect.any(String),
      "--allowedTools",
      expectedRule("Read", `${wt}/**`),
      expectedRule("Glob", `${wt}/**`),
      expectedRule("Grep", `${wt}/**`),
      expectedRule("Edit", `${wt}/**`),
      expectedRule("Write", `${wt}/**`),
      "Bash",
      "StructuredOutput",
      "Skill",
      "TodoWrite",
      expectedRule("NotebookEdit", `${wt}/**`),
      "Agent",
      "Task",
      expectedRule("Read", `${String(env.HOME)}/.claude/skills/**`),
      expectedRule("Read", `${String(env.HOME)}/.claude/plugins/**`),
      "--disallowedTools",
      "Bash(git push:*)",
      expectedRule("Edit", `${wt}/.git`),
      expectedRule("Edit", `${wt}/.git/**`),
      expectedRule("Edit", `${started.clone}/**`),
    ]);
  });

  it("lets the hook approve a write under .claude/skills of the worktree", async () => {
    const { claude, started } = await prepareAndStartExecute({ claude: { stream: claudeSample("plain") } });

    expect(claude.calls()[0].settings).toMatchObject(permissionHookSettings(started.worktree));
  });

  it("runs the shell in the sandbox with the write paths and the read deny list", async () => {
    const { claude, env, started, surface } = await prepareAndStartExecute({
      claude: { stream: claudeSample("plain") },
    });

    await expectTaskSandbox(claude.calls()[0].settings, surface, started.worktree, env);
  });

  it("denies the ssh keys and the publish tokens of every configured repo in the shell", async () => {
    const keys = useTempDir("tasker-keys-");
    const { claude, started } = await prepareAndStartExecute({
      claude: { stream: claudeSample("plain") },
      sshKey: join(keys, "a_key"),
      otherRepo: { key: "codeguru42/other", sshKey: join(keys, "b_key") },
    });

    const denyRead = (claude.calls()[0].settings as { sandbox: { filesystem: { denyRead: string[] } } }).sandbox
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

    expect(flagValues(claude.calls()[0].argv, "--json-schema")).toEqual([JSON.stringify(jsonSchema)]);
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
    expect(flagValues(first.argv, "--session-id")).toEqual([prepared.sessionId]);
    expect(first.argv).not.toContain("--resume");
    expect(flagValues(second.argv, "--resume")).toEqual([prepared.sessionId]);
    expect(second.argv).not.toContain("--session-id");
  });

  it("continues a recorded session with --resume on every start", async () => {
    const recorded = {
      repoKey: "codeguru42/tasker",
      provider: "claude-code",
      model: "haiku",
      effort: "low",
      trustedExtensions: [] as string[],
    } as const;

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

  it("denies the credentials of Codex to the shell of a claude-code run", async () => {
    const { claude } = await prepareAndStartExecute(
      { claude: { stream: claudeSample("plain") } },
      { env: (env) => ({ ...env, CODEX_HOME: "/cx" }) },
    );

    expect(claude.calls()[0].settings).toMatchObject({
      sandbox: { filesystem: { denyRead: expect.arrayContaining(["/cx/auth.json"]) } },
    });
  });

  it("denies each pi credential file to the shell of a claude-code run", async () => {
    const { claude } = await prepareAndStartExecute(
      { claude: { stream: claudeSample("plain") } },
      { env: (env) => ({ ...env, TASKER_PI_CODING_AGENT_DIR: "/pi/custom" }) },
    );

    expect(claude.calls()[0].settings).toMatchObject({
      sandbox: {
        filesystem: {
          denyRead: expect.arrayContaining([
            "/pi/custom/auth.json",
            "/pi/custom/mcp-auth.json",
            "/pi/custom/models.json",
          ]),
        },
      },
    });
  });

  it("denies PI_CODING_AGENT_DIR files to the shell of a claude-code run", async () => {
    const { claude } = await prepareAndStartExecute(
      { claude: { stream: claudeSample("plain") } },
      { env: (env) => ({ ...env, PI_CODING_AGENT_DIR: "/u" }) },
    );

    expect(claude.calls()[0].settings).toMatchObject({
      sandbox: {
        filesystem: {
          denyRead: expect.arrayContaining(["/u/auth.json", "/u/mcp-auth.json", "/u/models.json"]),
        },
      },
    });
  });

  describe("the read rules of the skills", () => {
    // The allow rules of one start, with the env of the fixture edited by edit.
    async function allowRules(edit: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv) {
      const { claude, env } = await prepareAndStartExecute(
        { claude: { stream: claudeSample("plain") } },
        { env: edit },
      );
      return { rules: flagValues(claude.calls()[0].argv, "--allowedTools")!, env };
    }

    it("names the folder of CLAUDE_CONFIG_DIR and not HOME/.claude", async () => {
      const dir = useTempDir("tasker-claude-");

      const { rules, env } = await allowRules((env) => ({ ...env, CLAUDE_CONFIG_DIR: dir }));

      expect(rules).toEqual(
        expect.arrayContaining([expectedRule("Read", `${dir}/skills/**`), expectedRule("Read", `${dir}/plugins/**`)]),
      );
      expect(rules.filter((rule) => rule.includes(`(/${join(env.HOME!, ".claude")}`))).toEqual([]);
    });

    it("names HOME/.claude when only HOME is set", async () => {
      const { rules, env } = await allowRules((env) => ({ ...env, CLAUDE_CONFIG_DIR: undefined }));

      expect(rules).toEqual(
        expect.arrayContaining([
          expectedRule("Read", `${String(env.HOME)}/.claude/skills/**`),
          expectedRule("Read", `${String(env.HOME)}/.claude/plugins/**`),
        ]),
      );
    });

    it("gives no skill rule when neither variable is set", async () => {
      const { rules } = await allowRules((env) => ({ ...env, CLAUDE_CONFIG_DIR: undefined, HOME: "  " }));

      expect(rules.filter((rule) => rule.startsWith("Read(") && /skills|plugins/.test(rule))).toEqual([]);
    });

    it.each([
      ["HOME", (env: NodeJS.ProcessEnv) => env],
      ["CLAUDE_CONFIG_DIR", (env: NodeJS.ProcessEnv) => ({ ...env, CLAUDE_CONFIG_DIR: useTempDir("tasker-claude-") })],
    ])("never allows the whole configuration folder, with %s set", async (_name, edit) => {
      const { rules, env } = await allowRules(edit);
      const folder = resolve(env.CLAUDE_CONFIG_DIR ?? join(env.HOME!, ".claude"));

      const named = rules.filter((rule) => rule.includes(`(/${folder}`));
      expect(named).toEqual([
        expectedRule("Read", `${folder}/skills/**`),
        expectedRule("Read", `${folder}/plugins/**`),
      ]);
      for (const whole of [folder, `${folder}/**`, `${folder}/*`]) {
        expect(rules).not.toContain(expectedRule("Read", whole));
      }
    });
  });
});

describe("the quota event record of a run", () => {
  // The sample plain without its rate_limit_event line.
  const plainWithoutQuota = () => claudeSample("plain").filter((line) => !line.includes('"rate_limit_event"'));

  it("keeps the last quota event of the plan role run for the repo, and still gives every event to the listener", async () => {
    const added = claudeRateLimitEvent((info) => {
      info.utilization = 0.5;
    });
    const lines = claudeSample("plain");
    const stream = [...lines.slice(0, -1), JSON.stringify(added), lines.at(-1)!];
    const fixture = await useAssistantRunFixture({ claude: { stream } });
    const before = Date.now();

    const { events } = await runPlanMode(fixture);

    const after = Date.now();
    const records = quotaEventsOf(fixture.started.dataRoot);
    expect(records).toEqual([
      { repoKey: fixture.started.repoKey, provider: "claude-code", receivedAt: expect.any(String), event: added },
    ]);
    const receivedAt = new Date(records[0].receivedAt);
    expect(receivedAt.toISOString()).toBe(records[0].receivedAt);
    expect(receivedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(receivedAt.getTime()).toBeLessThanOrEqual(after);
    expect(events).toEqual(stream.map((line) => JSON.parse(line) as AssistantEvent));
  });

  it("keeps the quota event of the execute role run for the repo", async () => {
    const { started } = await prepareAndStartExecute({ claude: { stream: claudeSample("plain") } });

    expect(quotaEventsOf(started.dataRoot)).toEqual([
      {
        repoKey: started.repoKey,
        provider: "claude-code",
        receivedAt: expect.any(String),
        event: claudeSampleEvents("plain").find((event) => event.type === "rate_limit_event"),
      },
    ]);
  });

  it("keeps no record when the stream has no quota event", async () => {
    const fixture = await useAssistantRunFixture({ claude: { stream: plainWithoutQuota() } });

    await runPlanMode(fixture);

    expect(quotaEventsOf(fixture.started.dataRoot)).toEqual([]);
  });
});

describe("the values of a session in an execute run", () => {
  const codexRecorded = {
    repoKey: "codeguru42/tasker",
    provider: "codex",
    model: "haiku",
    effort: "low",
    trustedExtensions: [] as string[],
  } as const;

  it("stores the thread id and the total of the first start, and the second start continues from them", async () => {
    const { codex, outcomes } = await prepareAndStartExecute(
      { claude: { stream: claudeSample("plain") } },
      {
        codex: { stream: codexSample("plain") },
        starts: [{ prompt: "p" }, { prompt: "q" }],
        beforeStart: (store, prepared) => {
          seedPlanSession(store, 1, { sessionId: prepared.sessionId, provider: "codex" });
        },
      },
    );

    const [first, second] = codex!.calls();
    expect(first.argv).not.toContain("resume");
    expect(second.argv).toContain("resume");
    expect(second.argv).toContain(CODEX_THREAD_ID);
    expect(outcomes[0].usage).toEqual(CODEX_PLAIN_USAGE);
    expect(outcomes[1].usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it("passes the stored id and total to a continued run of codex", async () => {
    const { codex, outcome } = await prepareAndStartExecute(
      { claude: { stream: claudeSample("plain") } },
      {
        codex: { stream: codexSample("resume") },
        session: { resume: true, sessionId: TEST_EXECUTE_SESSION_ID, recorded: codexRecorded },
        beforeStart: (store) => {
          seedPlanSession(store, 1, { sessionId: TEST_EXECUTE_SESSION_ID, provider: "codex" });
          store.setProviderSessionId(1, TEST_EXECUTE_SESSION_ID, CODEX_THREAD_ID);
          store.setSessionUsageTotal(1, TEST_EXECUTE_SESSION_ID, CODEX_PLAIN_USAGE);
        },
      },
    );

    expect(codex!.calls()[0].argv).toContain(CODEX_THREAD_ID);
    expect(outcome.usage).toEqual(CODEX_RESUME_USAGE);
  });

  it("leaves the five columns NULL for a claude-code run", async () => {
    const { started, prepared } = await prepareAndStartExecute(
      { claude: { stream: claudeSample("plain") } },
      {
        beforeStart: (store, prepared) => {
          seedPlanSession(store, 1, { sessionId: prepared.sessionId });
        },
      },
    );

    expect(sessionValuesOf(databasePathOf(started.dataRoot), prepared.sessionId)).toEqual(NO_SESSION_VALUES);
  });
});
