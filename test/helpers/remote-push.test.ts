import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { realCommandPath } from "./fake-commands.js";
import { moveOrigin, pushBranch, shell, signalTasker } from "./remote-push.js";
import { useStartedTask } from "./task-fixtures.js";

const run = (script: string[], cwd: string, env: NodeJS.ProcessEnv) =>
  execFileSync(script[0], script.slice(1), { cwd, env });

describe("remote push helpers", () => {
  it("shell runs a script with sh", () => {
    expect(shell("true")).toEqual([realCommandPath("sh"), "-c", "true"]);
  });

  it("signalTasker builds a kill command for the test process", () => {
    expect(signalTasker("SIGINT")).toBe(`kill -s INT ${process.pid}`);
  });

  it("pushBranch makes the task branch on the origin equal to main", async () => {
    const started = await useStartedTask();
    expect(await started.origin.branchHead(started.branch)).toBeUndefined();

    run(pushBranch, started.worktree, started.env);

    expect(await started.origin.branchHead(started.branch)).toBe(await started.origin.branchHead("main"));
  });

  it("moveOrigin moves the origin folder away", async () => {
    const started = await useStartedTask();

    run(moveOrigin, started.worktree, started.env);

    expect(existsSync(started.origin.path)).toBe(false);
  });
});
