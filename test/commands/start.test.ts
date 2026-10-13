import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { start } from "../../src/commands/start.js";
import { createDataRoot } from "../../src/store/layout.js";
import { openStore } from "../../src/store/store.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { lockNames, runCommand, taskNames, useStartFixture } from "../helpers.js";

const KEY = "codeguru42/tasker#5";

// The events of the only task of the issue, as { type, data }.
function eventsOf(dataRoot: string): { type: string; data: unknown }[] {
  const store = openStore(createDataRoot(dataRoot).database);
  try {
    const task = store.findLatestTask("codeguru42/tasker", KEY);
    if (task === undefined) throw new Error("no task");
    return store.listEvents(task.id).map(({ type, data }) => ({ type, data }));
  } finally {
    store.close();
  }
}

describe("start", () => {
  it("takes a new task to workspace_ready", async () => {
    const fixture = await useStartFixture({
      repo: { bootstrap: { commands: ["touch bootstrap.ran"], env: [] } },
    });
    const { dataRoot, repoKey } = fixture;
    const names = taskNames(repoPaths(dataRoot, repoKey).worktrees, 5, "Issue 5");

    const result = await runCommand(start, "start", KEY);

    expect(result).toEqual({
      code: 0,
      err: "tasker saved main as the default base branch of codeguru42/tasker.\n",
      out:
        "issue: codeguru42/tasker#5\n" +
        "repo: codeguru42/tasker\n" +
        "state: workspace_ready\n" +
        "base: main\n" +
        `branch: ${names.branch}\n` +
        `worktree: ${names.worktree}\n`,
    });
    expect(existsSync(join(names.worktree, "bootstrap.ran"))).toBe(true);
    const events = eventsOf(dataRoot);
    expect(events.map((event) => event.type)).toEqual([
      "created",
      "base",
      "workspace",
      "bootstrap",
      "transition",
    ]);
    expect(events[1].data).toMatchObject({ base: "main", source: "config" });
    expect(events[2].data).toMatchObject({ path: names.worktree, taskRef: names.branch, state: "created" });
    expect(events[3].data).toMatchObject({ status: "ok" });
    expect(events[4].data).toMatchObject({ from: "provisioning", to: "workspace_ready" });
    expect(lockNames(dataRoot)).toEqual([]);
  });

  it("uses the learned default base when the configuration has none", async () => {
    const fixture = await useStartFixture({ repo: { defaultBaseBranch: undefined } });
    await fixture.origin.createBranch("dev");
    const store = openStore(createDataRoot(fixture.dataRoot).database);
    try {
      store.setDefaultBaseBranch(fixture.repoKey, "dev");
    } finally {
      store.close();
    }

    const result = await runCommand(start, "start", KEY);

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: dev\n");
    expect(eventsOf(fixture.dataRoot)[1].data).toMatchObject({ base: "dev", source: "learned" });
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("uses the base label of the issue and does not learn it", async () => {
    const fixture = await useStartFixture({
      issues: [{ project: "codeguru42/tasker", number: 5, labels: ["base: dev"] }],
    });
    await fixture.origin.createBranch("dev");

    const result = await runCommand(start, "start", KEY);

    expect(result).toMatchObject({ code: 0, err: "" });
    expect(result.out).toContain("base: dev\n");
    expect(eventsOf(fixture.dataRoot)[1].data).toMatchObject({ base: "dev", source: "hint" });
    const store = openStore(createDataRoot(fixture.dataRoot).database);
    try {
      expect(store.getDefaultBaseBranch(fixture.repoKey)).toBeUndefined();
    } finally {
      store.close();
    }
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("uses --base as the explicit base", async () => {
    const fixture = await useStartFixture();
    await fixture.origin.createBranch("dev");

    const result = await runCommand(start, "start", KEY, "--base", "dev");

    expect(result.code).toBe(0);
    expect(result.out).toContain("base: dev\n");
    expect(eventsOf(fixture.dataRoot)[1].data).toMatchObject({ base: "dev", source: "explicit" });
    expect(lockNames(fixture.dataRoot)).toEqual([]);
  });

  it("prints the description of the command and of both options for --help", async () => {
    const { code, out } = await runCommand(start, "start", "--help");

    expect(code).toBe(0);
    // Commander wraps the long lines of the help, so compare with single spaces.
    const help = out.replace(/\s+/g, " ");
    expect(help).toContain(
      "Make a task for an issue and take it to workspace_ready: read the issue, make the clone, resolve the base, make the worktree and run bootstrap",
    );
    expect(help).toContain(
      "Use the repo with this key when two repos share the project of the issue",
    );
    expect(help).toContain(
      "The base branch of this task only: a branch on origin, or refs/heads/<branch> for a local branch of the clone",
    );
  });
});
