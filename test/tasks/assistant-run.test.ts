import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AssistantEvent } from "../../src/assistant/provider.js";
import { taskSessionsDir } from "../../src/store/layout.js";
import { vcsForRepo } from "../../src/vcs/provider.js";
import { executeReadDenyPaths, prepareTaskExecuteRun, prepareTaskPlanModeRun } from "../../src/tasks/assistant-run.js";
import {
  claudeSample,
  readRunMarker,
  useAssistantRunFixture,
  withDataRootStore,
} from "../helpers.js";

// The arguments of argv that follow flag, up to the next flag.
function flagValues(argv: string[], flag: string): string[] | undefined {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  const rest = argv.slice(at + 1);
  const next = rest.findIndex((arg) => arg.startsWith("--"));
  return next === -1 ? rest : rest.slice(0, next);
}

describe("executeReadDenyPaths", () => {
  // Every path here is fake. None exists on disk, and each still goes in the list.
  const surfaceDenyReadPaths = ["/k/id"];
  const publishTokensPath = "/p";
  const denyPaths = (env: NodeJS.ProcessEnv) =>
    executeReadDenyPaths({ env, surfaceDenyReadPaths, publishTokensPath });

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

  it("gives the default configuration file under HOME", () => {
    expect(denyPaths({ HOME: "/h" }).at(-1)).toBe("/h/.config/tasker/config.json");
  });
});

describe("prepareTaskPlanModeRun", () => {
  const schema = { type: "object" };

  const prepareAndStart = async (
    role: "plan" | "review",
    options: Parameters<typeof useAssistantRunFixture>[0] = { claude: { stream: claudeSample("json-schema") } },
  ) => {
    const fixture = await useAssistantRunFixture(options);
    const { config, task, env, started } = fixture;
    const events: AssistantEvent[] = [];
    const outcome = await withDataRootStore(started.dataRoot, async (store) => {
      const prepared = await prepareTaskPlanModeRun({ config, store, task, role, session: { resume: false }, env });
      const outcome = await prepared.start({ prompt: "p", jsonSchema: schema, onEvent: (e) => events.push(e) });
      return { prepared, outcome };
    });
    return { ...fixture, ...outcome, events, models: config.repos[started.repoKey]!.assistant.models };
  };

  it("runs the assistant in the plan mode with the plan model and no other limit", async () => {
    const { claude, prepared, outcome, models, events, config, task, started } = await prepareAndStart("plan");

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
    expect(readRunMarker(`${started.dataRoot}/tasker.db`, task.id)?.child_pid).toBeGreaterThan(0);
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
    const { claude, models } = await prepareAndStart("review");

    const call = claude.calls()[0]!;
    expect(flagValues(call.argv, "--model")).toEqual([models.review.model]);
    expect(flagValues(call.argv, "--effort")).toEqual([models.review.effort]);
    expect(flagValues(call.argv, "--permission-mode")).toEqual(["plan"]);
    expect(flagValues(call.argv, "--disallowedTools")).toEqual(["Bash(git push:*)"]);
    expect(call.argv).not.toContain("--allowedTools");
    expect(call.argv).not.toContain("--settings");
  });

  it("refuses a task that has no worktree, and starts no child", async () => {
    const { config, task, env, claude, started } = await useAssistantRunFixture({
      claude: { stream: claudeSample("json-schema") },
    });

    await withDataRootStore(started.dataRoot, async (store) => {
      await expect(
        prepareTaskPlanModeRun({
          config,
          store,
          task: { ...task, worktreePath: null },
          role: "plan",
          session: { resume: false },
          env,
        }),
      ).rejects.toThrow(`task ${task.id}`);
    });
    expect(claude.calls()).toEqual([]);
  });

  it("stops the run at the plan deadline", async () => {
    const { outcome } = await prepareAndStart("plan", {
      claude: { stream: claudeSample("json-schema"), untilStopped: true },
      limits: { planTimeoutMin: 0.001 },
    });

    expect(outcome.kind).toBe("timeout");
  });
});

describe("prepareTaskExecuteRun", () => {
  // The rule form of claude: // marks an absolute path. It is computed here, apart from the code under test.
  const expectedRule = (tool: string, path: string) => `${tool}(/${path})`;

  const prepareAndStart = async (options: Parameters<typeof useAssistantRunFixture>[0]) => {
    const fixture = await useAssistantRunFixture({ state: "executing", ...options });
    const { config, task, env, started } = fixture;
    const result = await withDataRootStore(started.dataRoot, async (store) => {
      const prepared = await prepareTaskExecuteRun({ config, store, task, session: { resume: false }, env });
      const outcome = await prepared.start({ prompt: "p" });
      return { prepared, outcome };
    });
    const { vcs, ctx } = vcsForRepo(config, started.repoKey, env);
    return {
      ...fixture,
      ...result,
      surface: vcs.assistantSurface(ctx),
      models: config.repos[started.repoKey]!.assistant.models,
    };
  };

  it("runs the assistant under dontAsk with the execute model and the file tools of the worktree", async () => {
    const { claude, models, started } = await prepareAndStart({ claude: { stream: claudeSample("plain") } });

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
    const { claude, env, started, surface } = await prepareAndStart({ claude: { stream: claudeSample("plain") } });

    expect(claude.calls()[0]!.settings).toMatchObject({
      sandbox: {
        filesystem: {
          allowWrite: await surface.sandboxWritePaths(started.worktree),
          denyRead: executeReadDenyPaths({
            env,
            surfaceDenyReadPaths: surface.denyReadPaths,
            publishTokensPath: surface.publishTokensPath,
          }),
        },
      },
    });
  });

  it("gives the commit text of the surface", async () => {
    const { prepared, surface } = await prepareAndStart({ claude: { stream: claudeSample("plain") } });

    expect(prepared.executeCommitText).toBe(surface.executeCommitText);
  });

  it("stops the run at the execute deadline, not the plan deadline", async () => {
    const { outcome } = await prepareAndStart({
      claude: { stream: claudeSample("plain"), untilStopped: true },
      limits: { executeTimeoutMin: 0.001, planTimeoutMin: 60 },
    });

    expect(outcome.kind).toBe("timeout");
  });
});
