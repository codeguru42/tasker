import { describe, expect, it } from "vitest";
import { run } from "../../src/cli.js";
import { captureIo } from "../helpers/cli.js";
import { commitInWorktree, copyCloneBranchToOrigin } from "../helpers/git.js";
import { databasePathOf, eventsOf, latestTaskOf, readRunMarker, withDataRootStore } from "../helpers/store.js";
import { useAcceptedTask, useAcceptedTaskWithNoRevision, useWorkReviewTask } from "../helpers/task-fixtures.js";
import { wrongStateError } from "../helpers/state-commands.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

const runPush = async (key = KEY) => {
  const io = captureIo();
  const code = await run(["push", key, "--repo", REPO], { io });
  return { code, out: io.out.join(""), err: io.err.join("") };
};

describe("tasker push", () => {
  it("publishes only the task branch and records the provider result", async () => {
    const accepted = await useAcceptedTask();
    withDataRootStore(accepted.dataRoot, (store) => store.updateTask(accepted.task.id, { base: null, prNumber: 73 }));
    const base = await accepted.origin.branchHead("main");
    const ghCalls = accepted.gh.calls();
    const before = eventsOf(accepted.dataRoot, KEY);

    const result = await runPush();

    expect(result).toEqual({
      code: 0,
      out: `pushed ${accepted.task.branch!} at ${accepted.revision}\nstate: pushed\n`,
      err: "",
    });
    expect(await accepted.origin.branchHead(accepted.task.branch!)).toBe(accepted.revision);
    expect(await accepted.origin.branchHead("main")).toBe(base);
    expect(latestTaskOf(accepted.dataRoot, KEY)).toMatchObject({
      state: "pushed",
      publishedRevision: accepted.revision,
      prNumber: 73,
    });
    expect(eventsOf(accepted.dataRoot, KEY).slice(before.length)).toEqual([
      { type: "transition", data: { from: "accepted", to: "pushing" } },
      {
        type: "published",
        data: {
          branch: accepted.task.branch,
          revision: accepted.revision,
          lease: true,
          pushed: true,
          from: "pushing",
          to: "pushed",
        },
      },
    ]);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
    expect(accepted.gh.calls()).toEqual(ghCalls);
  });

  it("refuses an unaccepted tip before it changes task state or origin", async () => {
    const accepted = await useAcceptedTask();
    const moved = await commitInWorktree(accepted.task.worktreePath!, accepted.env, { file: "late.txt" });
    const before = eventsOf(accepted.dataRoot, KEY);

    const result = await runPush();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("the tip of");
    expect(result.err).toContain(`(${moved}) is not the accepted revision (${accepted.revision})`);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("accepted");
    expect(eventsOf(accepted.dataRoot, KEY)).toEqual(before);
    expect(await accepted.origin.branchHead(accepted.task.branch!)).toBeUndefined();
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("refuses a task that is not accepted", async () => {
    const work = await useWorkReviewTask();

    const result = await runPush();

    expect(result.code).toBe(1);
    expect(result.err).toContain(wrongStateError("awaiting_work_review", KEY, "push", "accepted"));
    expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_work_review");
  });

  it("refuses a task with no accepted revision", async () => {
    const accepted = await useAcceptedTaskWithNoRevision();

    const result = await runPush();

    expect(result.code).toBe(1);
    expect(result.err).toContain(`the task of ${KEY} has no accepted revision`);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("accepted");
  });

  it("reports an existing remote copy without pushing it again", async () => {
    const accepted = await useAcceptedTask();
    await copyCloneBranchToOrigin({
      origin: accepted.origin.path,
      clone: accepted.clone,
      branch: accepted.task.branch!,
      env: accepted.env,
    });
    withDataRootStore(accepted.dataRoot, (store) => {
      store.updateTask(accepted.task.id, { publishedRevision: accepted.revision });
    });

    const result = await runPush();

    expect(result.code).toBe(0);
    expect(result.out).toBe(`${accepted.task.branch!} is already on origin at ${accepted.revision}\nstate: pushed\n`);
    expect(latestTaskOf(accepted.dataRoot, KEY)).toMatchObject({
      state: "pushed",
      publishedRevision: accepted.revision,
    });
    expect(eventsOf(accepted.dataRoot, KEY).at(-1)).toEqual({
      type: "published",
      data: {
        branch: accepted.task.branch,
        revision: accepted.revision,
        lease: false,
        pushed: false,
        from: "pushing",
        to: "pushed",
      },
    });
  });
});
