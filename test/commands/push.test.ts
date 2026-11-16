import { describe, expect, it } from "vitest";
import { run } from "../../src/cli.js";
import { captureIo } from "../helpers/cli.js";
import { commitInWorktree, copyCloneBranchToOrigin } from "../helpers/git.js";
import { databasePathOf, eventsOf, latestTaskOf, readRunMarker, withDataRootStore } from "../helpers/store.js";
import { useAcceptedTask, useAcceptedTaskWithNoRevision, useWorkReviewTask } from "../helpers/task-fixtures.js";
import { wrongStateError } from "../helpers/state-commands.js";
import { fakeGh, ghTokenAnswer, githubWriteAnswer } from "../helpers/fake-gh.js";
import { useProcessEnv, useTempDir } from "../helpers/temp.js";
import { installForgeGh, openPrTokenAnswer, openPrViewArgs, OPEN_PR_FORGE_ACCOUNT } from "../helpers/forge-gh.js";

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

  describe("with a recorded PR", () => {
    const url = "https://github.com/codeguru42/tasker/pull/12";
    const view = (branch: string, state: string) =>
      JSON.stringify({
        number: 12,
        url,
        state,
        headRefName: branch,
        baseRefName: "main",
        isCrossRepository: false,
      });

    async function recordedPrTask(
      options: Parameters<typeof useAcceptedTask>[0] = {
        repo: { forge: { provider: "github", account: OPEN_PR_FORGE_ACCOUNT } },
      },
    ) {
      const accepted = await useAcceptedTask(options);
      withDataRootStore(accepted.dataRoot, (store) => store.updateTask(accepted.task.id, { prNumber: 12 }));
      return accepted;
    }

    it("moves the task to in_peer_review when the PR is open", async () => {
      const accepted = await recordedPrTask();
      const branch = accepted.task.branch!;
      installForgeGh(
        [openPrTokenAnswer(), { args: openPrViewArgs(12), stdout: view(branch, "OPEN") }],
        "tasker-push-open-gh-",
      );

      const result = await runPush();

      expect(result).toEqual({
        code: 0,
        out: `pushed ${branch} at ${accepted.revision}\nPR #12 is open: ${url}\nstate: in_peer_review\n`,
        err: "",
      });
      expect(latestTaskOf(accepted.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 12 });
    });

    it("prints the tracker lines before the push line when it moves the task to in_peer_review", async () => {
      const accepted = await recordedPrTask({
        repo: {
          forge: { provider: "github", account: OPEN_PR_FORGE_ACCOUNT },
          issueTracker: {
            provider: "github",
            account: "codeguru42",
            updateOnStart: true,
            inProgressLabel: "in progress",
            reviewLabel: "peer-review",
          },
        },
        ghAnswers: [
          githubWriteAnswer({
            project: "codeguru42/tasker",
            number: 5,
            verb: "edit",
            rest: ["--add-assignee", "@me"],
          }),
          githubWriteAnswer({
            project: "codeguru42/tasker",
            number: 5,
            verb: "edit",
            rest: ["--add-label", "in progress"],
          }),
        ],
      });
      const branch = accepted.task.branch!;
      const fake = fakeGh(useTempDir("tasker-push-review-output-"), process.env, [
        openPrTokenAnswer(),
        { args: openPrViewArgs(12), stdout: view(branch, "OPEN") },
        ghTokenAnswer("codeguru42", "gho_test"),
        githubWriteAnswer({
          project: "codeguru42/tasker",
          number: 5,
          verb: "edit",
          rest: ["--add-label", "peer-review"],
        }),
        githubWriteAnswer({
          project: "codeguru42/tasker",
          number: 5,
          verb: "edit",
          rest: ["--remove-label", "in progress"],
        }),
      ]);
      useProcessEnv({
        TASKER_GH_BIN: fake.env.TASKER_GH_BIN,
        PATH: `${fake.env.PATH ?? ""}:${process.env.PATH ?? ""}`,
      });

      const result = await runPush();

      expect(result).toEqual({
        code: 0,
        out:
          `added the label "peer-review" to ${KEY} on the tracker\n` +
          `cleared the in-progress marker of ${KEY} on the tracker\n` +
          `pushed ${branch} at ${accepted.revision}\n` +
          `PR #12 is open: ${url}\n` +
          "state: in_peer_review\n",
        err: "",
      });
    });

    it("keeps the task in pushed and says why when the PR is closed", async () => {
      const accepted = await recordedPrTask();
      const branch = accepted.task.branch!;
      installForgeGh(
        [openPrTokenAnswer(), { args: openPrViewArgs(12), stdout: view(branch, "CLOSED") }],
        "tasker-push-closed-gh-",
      );

      const result = await runPush();

      expect(result).toEqual({
        code: 0,
        out: `pushed ${branch} at ${accepted.revision}\nPR #12 is closed, so the task stays in pushed\nstate: pushed\n`,
        err: "",
      });
      expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("pushed");
    });

    it("warns on stderr and keeps the task in pushed when gh fails", async () => {
      const accepted = await recordedPrTask();
      const branch = accepted.task.branch!;
      installForgeGh(
        [
          openPrTokenAnswer(),
          {
            args: openPrViewArgs(12),
            exitCode: 1,
            stderr: "GraphQL: Could not resolve to a PullRequest with the number of 12. (repository.pullRequest)",
          },
        ],
        "tasker-push-failed-gh-",
      );

      const result = await runPush();

      expect(result.code).toBe(0);
      expect(result.out).toBe(`pushed ${branch} at ${accepted.revision}\nstate: pushed\n`);
      expect(result.err).toMatch(/^warning: cannot read PR #12 on the forge, so the task stays in pushed: /);
      expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("pushed");
    });
  });
});
