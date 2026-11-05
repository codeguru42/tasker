import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reopen } from "../../src/commands/reopen.js";
import { archivePrompt } from "../../src/prompts/archive.js";
import { REFINE_PROMPT, REFINE_PROMPT_NAME } from "../../src/prompts/refine.js";
import { planRevisionPath, planTranscriptPath } from "../../src/store/layout.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { TEST_SESSION_ID } from "../helpers/fake-claude.js";
import { commitInWorktree, gitOutput } from "../helpers/git.js";
import { answerStream, planRevisionOf, validPlanAnswer } from "../helpers/plan.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  readRunMarker,
  withDataRootStore,
  withRawDatabase,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  expectNoAssistantRun,
  useReopenFixture,
  useStackedPlanTasks,
} from "../helpers/task-fixtures.js";
import { wrongStateError } from "../helpers/state-commands.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const FEEDBACK = "A bug appeared after acceptance. Preserve the published revision and fix the bug.";
const V2 = validPlanAnswer({
  plan_markdown: "## Summary\n\nFix the bug in the published work.\n",
  questions: [],
});

const runReopen = (feedback = FEEDBACK, key = KEY, ...args: string[]) =>
  runCommand(reopen, "reopen", key, feedback, "--repo", REPO, ...args);

describe("reopen", () => {
  it("requires feedback and lists the shared repo option", async () => {
    const { code, help } = await runHelp(reopen, "reopen");

    expect(code).toBe(0);
    expect(help).toContain("<issue> <feedback>");
    expect(help).toContain("--repo <key>");
  });

  it.each(["accepted", "pushed"] as const)(
    "resyncs a %s task, continues its plan session, and records an unapproved reopen revision",
    async (origin) => {
      const fixture = await useReopenFixture({ stream: answerStream(V2) }, origin);
      const before = eventsOf(fixture.started.dataRoot, KEY);
      const priorPublished = fixture.task.publishedRevision;

      const result = await runReopen();

      const task = latestTaskOf(fixture.started.dataRoot, KEY);
      const revision = planRevisionOf(fixture.started.dataRoot, task.id, 2);
      const stdin = fixture.claude.calls()[0].stdin;
      expect(result.code).toBe(0);
      expect(result.out).toContain(`reopened ${KEY} as revision v2\n`);
      expect(result.out).toContain("state: awaiting_plan_review\n");
      expect(task.state).toBe("awaiting_plan_review");
      expect(task.publishedRevision).toBe(priorPublished);
      expect(revision).toMatchObject({ source: "reopen", feedback: FEEDBACK, answer: V2, approvedAt: null });
      expect(stdin).toContain(
        "<context>A bug was found after acceptance. The user needs a new complete plan revision.</context>",
      );
      expect(stdin).toContain(`<feedback>${FEEDBACK}</feedback>`);
      expect(fixture.claude.calls()[0].argv).toContain(TEST_SESSION_ID);
      expect(eventsOf(fixture.started.dataRoot, KEY).slice(before.length, before.length + 1)).toEqual([
        { type: "transition", data: { from: origin, to: "refining", feedback: FEEDBACK } },
      ]);
      expect(readRunMarker(databasePathOf(fixture.started.dataRoot), task.id)).toBeUndefined();
    },
  );

  it.each(["accepted", "pushed"] as const)(
    "refuses a %s task with an invalid current plan before resync",
    async (origin) => {
      for (const invalid of ["missing plan file", "refused recorded model"] as const) {
        const fixture = await useReopenFixture(
          { stream: answerStream(V2) },
          origin,
          invalid === "refused recorded model" ? { session: { model: "gpt-5" } } : {},
        );
        const planPath = planRevisionPath(fixture.started.dataRoot, fixture.task, 1);
        if (invalid === "missing plan file") rmSync(planPath);
        await fixture.started.origin.addCommit("main", {
          file: `invalid-${origin}-${invalid.replaceAll(" ", "-")}.txt`,
        });
        const beforeTask = latestTaskOf(fixture.started.dataRoot, KEY);
        const beforeMarker = readRunMarker(databasePathOf(fixture.started.dataRoot), fixture.task.id);
        const beforeBranchHead = await gitOutput(
          { gitDir: fixture.started.clone },
          fixture.started.env,
          "rev-parse",
          `refs/heads/${String(fixture.task.branch)}`,
        );
        const beforeWorktreeHead = await gitOutput(
          { cwd: fixture.task.worktreePath! },
          fixture.started.env,
          "rev-parse",
          "HEAD",
        );
        const message =
          invalid === "missing plan file"
            ? /cannot read the plan file .* of revision v1/
            : "the plan session of codeguru42/tasker#5 runs on gpt-5, and claude-code refuses it: is not a claude-code model: gpt-5";

        await expectCommandRefused(
          fixture.started,
          () => runReopen(),
          typeof message === "string" ? `${message}\n` : message,
        );
        expect(latestTaskOf(fixture.started.dataRoot, KEY)).toEqual(beforeTask);
        expect(latestTaskOf(fixture.started.dataRoot, KEY).reopenStartHead).toBe(beforeTask.reopenStartHead);
        expect(readRunMarker(databasePathOf(fixture.started.dataRoot), fixture.task.id)).toEqual(beforeMarker);
        expect(planRevisionOf(fixture.started.dataRoot, fixture.task.id, 2)).toBeUndefined();
        expect(
          await gitOutput(
            { gitDir: fixture.started.clone },
            fixture.started.env,
            "rev-parse",
            `refs/heads/${String(fixture.task.branch)}`,
          ),
        ).toBe(beforeBranchHead);
        expect(await gitOutput({ cwd: fixture.task.worktreePath! }, fixture.started.env, "rev-parse", "HEAD")).toBe(
          beforeWorktreeHead,
        );
        expectNoAssistantRun(fixture);
      }
    },
  );

  it("requires a nonblank feedback before it writes", async () => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) });
    const before = eventsOf(fixture.started.dataRoot, KEY);

    await expectCommandRefused(
      { dataRoot: fixture.started.dataRoot, key: KEY },
      () => runReopen(" \n\t "),
      "the feedback is empty\n",
    );

    expectNoAssistantRun(fixture);
    expect(eventsOf(fixture.started.dataRoot, KEY)).toEqual(before);
  });

  it("refuses a task in a state outside accepted and pushed", async () => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) });
    withDataRootStore(fixture.started.dataRoot, (store) => store.updateTask(fixture.task.id, { state: "executed" }));

    await expectCommandRefused(
      { dataRoot: fixture.started.dataRoot, key: KEY },
      () => runReopen(),
      `${wrongStateError("executed", KEY, "reopen", "accepted or pushed")}\n`,
    );
  });

  it.each([
    ["branch", { branch: null }, `the task of ${KEY} has no branch\n`],
    ["worktree", { worktreePath: null }, `the task of ${KEY} has no worktree\n`],
    ["base", { base: null }, `the task of ${KEY} has no base revision\n`],
  ])("refuses a task with no stored %s", async (_name, changes, message) => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) });
    withDataRootStore(fixture.started.dataRoot, (store) => store.updateTask(fixture.task.id, changes));

    await expectCommandRefused({ dataRoot: fixture.started.dataRoot, key: KEY }, () => runReopen(), message);
    expectNoAssistantRun(fixture);
  });

  it("refuses when the plan session is missing", async () => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) });
    withDataRootStore(fixture.started.dataRoot, (store) => store.clearPlanSession(fixture.task.id));

    await expectCommandRefused({ dataRoot: fixture.started.dataRoot, key: KEY }, () => runReopen(), /no plan session/);
    expectNoAssistantRun(fixture);
  });

  it("refuses a dirty worktree before it resyncs or starts the assistant", async () => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) });
    writeFileSync(join(fixture.task.worktreePath!, "uncommitted.txt"), "local edit\n");

    await expectCommandRefused(
      { dataRoot: fixture.started.dataRoot, key: KEY },
      () => runReopen(),
      /uncommitted changes/,
    );
    expectNoAssistantRun(fixture);
  });

  it.each(["rebase", "merge"] as const)("fetches the stored base and applies the %s strategy", async (strategy) => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) }, "accepted", {
      repo: { updateBranchStrategy: strategy },
    });
    const newBase = await fixture.started.origin.addCommit("main", { file: `base-${strategy}.txt` });

    const result = await runReopen();

    expect(result.code).toBe(0);
    expect(latestTaskOf(fixture.started.dataRoot, KEY).syncedBaseTip).toBe(newBase);
  });

  it("keeps the published revision when resync moves HEAD", async () => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) }, "pushed");
    const published = fixture.task.publishedRevision;
    const beforeHead = await gitOutput(
      { gitDir: fixture.started.clone },
      fixture.started.env,
      "rev-parse",
      `refs/heads/${String(fixture.task.branch)}`,
    );
    await fixture.started.origin.addCommit("main", { file: "moved-base.txt" });

    const result = await runReopen();

    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    const afterHead = await gitOutput(
      { gitDir: fixture.started.clone },
      fixture.started.env,
      "rev-parse",
      `refs/heads/${String(fixture.task.branch)}`,
    );
    expect(result.code).toBe(0);
    expect(afterHead).not.toBe(beforeHead);
    expect(task.publishedRevision).toBe(published);
  });

  it("reports a failed base fetch and starts no assistant", async () => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) });
    const remote = fixture.started.origin.path;
    const hiddenRemote = `${remote}.hidden`;
    renameSync(remote, hiddenRemote);

    const result = await (async () => {
      try {
        return await runReopen();
      } finally {
        renameSync(hiddenRemote, remote);
      }
    })();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/reopening failed: git fetch failed/);
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
    expectNoAssistantRun(fixture);
  });

  it("reports the moved HEAD when the resync database write fails", async () => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) });
    const priorHead = await gitOutput(
      { gitDir: fixture.started.clone },
      fixture.started.env,
      "rev-parse",
      `refs/heads/${String(fixture.task.branch)}`,
    );
    await fixture.started.origin.addCommit("main", { file: "database-failure-base.txt" });
    withRawDatabase(databasePathOf(fixture.started.dataRoot), (db) => {
      db.exec(`CREATE TRIGGER reject_reopen_record BEFORE UPDATE OF synced_base_tip ON tasks
        WHEN NEW.synced_base_tip IS NOT OLD.synced_base_tip
        BEGIN SELECT RAISE(ABORT, 'reopen record failed'); END`);
    });

    const result = await runReopen();

    const movedHead = await gitOutput(
      { gitDir: fixture.started.clone },
      fixture.started.env,
      "rev-parse",
      `refs/heads/${String(fixture.task.branch)}`,
    );
    expect(movedHead).not.toBe(priorHead);
    expect(result.code).toBe(1);
    expect(result.err).toContain("reopen record failed");
    expect(result.err).toContain(movedHead);
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
  });

  it("replays stacked task commits onto the moved parent branch", async () => {
    const fixture = await useStackedPlanTasks({ stream: answerStream(V2) });
    const task = fixture.stacked.task;
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(task.id, { state: "accepted" }));
    await commitInWorktree(fixture.stacked.worktree, fixture.env, { file: "stacked-followup.txt" });
    await commitInWorktree(fixture.parent.worktree, fixture.env, { file: "parent-followup.txt" });

    const result = await runReopen(FEEDBACK, fixture.stacked.key);

    expect(result.code).toBe(0);
    expect(latestTaskOf(fixture.dataRoot, fixture.stacked.key).state).toBe("awaiting_plan_review");
  });

  it("reports an assistant failure and does not record a revision", async () => {
    const fixture = await useReopenFixture({ stream: answerStream(V2), exitCode: 1, stderr: "assistant failed" });

    const result = await runReopen();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^refining failed:/);
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("failed");
    expect(planRevisionOf(fixture.started.dataRoot, fixture.task.id, 2)).toBeUndefined();
  });

  it("does not publish, open a pull request, merge, or import comments", async () => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) }, "pushed");
    const mainBefore = await fixture.started.origin.branchHead("main");
    const taskBranchBefore = await fixture.started.origin.branchHead(fixture.task.branch!);
    const ghCalls = fixture.started.gh.calls();

    const result = await runReopen();

    expect(result.code).toBe(0);
    expect(await fixture.started.origin.branchHead("main")).toBe(mainBefore);
    expect(await fixture.started.origin.branchHead(fixture.task.branch!)).toBe(taskBranchBefore);
    expect(fixture.started.gh.calls()).toEqual(ghCalls);
  });

  it("archives the plan and prompt for the new revision", async () => {
    const fixture = await useReopenFixture({ stream: answerStream(V2) });

    await runReopen();

    const task = latestTaskOf(fixture.started.dataRoot, KEY);
    expect(existsSync(planRevisionPath(fixture.started.dataRoot, task, 2))).toBe(true);
    expect(existsSync(planTranscriptPath(fixture.started.dataRoot, task, 2))).toBe(true);
    expect(existsSync(archivePrompt(fixture.started.dataRoot, REFINE_PROMPT_NAME, REFINE_PROMPT).path)).toBe(true);
  });
});
