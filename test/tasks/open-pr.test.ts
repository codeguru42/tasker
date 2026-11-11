import { renameSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openPrTask } from "../../src/tasks/open-pr.js";
import { LockBusyError, repoLockName, taskLockName } from "../../src/store/locks.js";
import type { TaskStore } from "../../src/store/store.js";
import { captureIo } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { copyCloneBranchToOrigin } from "../helpers/git.js";
import { forgeStub } from "../helpers/forge.js";
import { startLockHolder } from "../helpers/processes.js";
import { runGit } from "../../src/vcs/git/run.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  readRunMarker,
  rejectPrOpenedEvent,
  withDataRootStore,
} from "../helpers/store.js";
import { taskRefOf, useAcceptedTask, type AcceptedTask } from "../helpers/task-fixtures.js";
import { fakeGh, ghTokenAnswer, githubWriteAnswer } from "../helpers/fake-gh.js";
import { useTempDir } from "../helpers/temp.js";
import {
  acliWriteResult,
  AUTH_STATUS_ARGS,
  fakeAcli,
  MEASURED_AUTH_STATUS,
  transitionArgs,
  jiraRefOf,
} from "../helpers/fake-acli.js";

const KEY = "codeguru42/tasker#5";

async function pushedTask(): Promise<AcceptedTask> {
  const accepted = await useAcceptedTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
  await copyCloneBranchToOrigin({
    origin: accepted.origin.path,
    clone: accepted.clone,
    branch: accepted.task.branch!,
    env: accepted.env,
  });
  withDataRootStore(accepted.dataRoot, (store) =>
    store.updateTask(accepted.task.id, { state: "pushed", publishedRevision: accepted.revision }),
  );
  return { ...accepted, task: latestTaskOf(accepted.dataRoot, KEY) };
}

async function callOpenPr(
  fixture: AcceptedTask,
  store: TaskStore,
  forge: ReturnType<typeof forgeStub>,
  repoLockWaitMs = 300,
  env: NodeJS.ProcessEnv = fixture.env,
  ref = taskRefOf(fixture),
) {
  const io = captureIo();
  const result = await openPrTask(store, {
    config: fixture.config,
    ref,
    taskId: fixture.task.id,
    env,
    io,
    repoLockWaitMs,
    forge: forge.provider,
  });
  return { result, io };
}

describe("openPrTask", () => {
  it.each(["peer-review", "Peer-Review"])(
    "keeps review label %s when it matches the in-progress label",
    async (label) => {
      const fixture = await pushedTask();
      Object.assign(fixture.config.repos[fixture.repoKey].issueTracker, {
        updateOnStart: true,
        inProgressLabel: "peer-review",
        reviewLabel: label,
      });
      const gh = fakeGh(useTempDir("tasker-open-pr-same-review-gh-"), fixture.env, [
        ghTokenAnswer("codeguru42", "gho_test"),
        githubWriteAnswer({
          project: "codeguru42/tasker",
          number: 5,
          verb: "edit",
          rest: ["--add-label", label],
        }),
      ]);

      const { result } = await withDataRootStore(fixture.dataRoot, (store) => {
        store.recordTrackerMark(fixture.task.id);
        return callOpenPr(fixture, store, forgeStub(), 300, { ...gh.env, PATH: fixture.env.PATH });
      });

      expect(result).toMatchObject({ adopted: false, pullRequest: { number: 42 } });
      expect(gh.calls().map((call) => call.args)).toEqual([
        ["issue", "edit", "5", "-R", "codeguru42/tasker", "--add-label", label],
      ]);
      expect(
        eventsOf(fixture.dataRoot, KEY).filter(
          (event) => event.type === "tracker_update" && (event.data as { action: string }).action !== "in_progress",
        ),
      ).toMatchObject([{ data: { action: "review", result: "ok" } }]);
    },
  );

  it("moves a Jira issue to review after recording the PR", async () => {
    const fixture = await pushedTask();
    Object.assign(fixture.config.repos[fixture.repoKey].issueTracker, {
      provider: "jira",
      project: "TEST",
      reviewStatus: "In Review",
    });
    const acli = fakeAcli(useTempDir("tasker-open-pr-jira-review-"), fixture.env, [
      { args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS },
      { args: transitionArgs("TEST-5", "In Review"), stdout: acliWriteResult("SUCCESS", "") },
    ]);
    const { result } = await withDataRootStore(fixture.dataRoot, (store) =>
      callOpenPr(
        fixture,
        store,
        forgeStub(),
        300,
        { ...acli.env, PATH: [acli.env.PATH, fixture.env.PATH].filter(Boolean).join(":") },
        { ...jiraRefOf("TEST-5"), repoKey: fixture.repoKey },
      ),
    );
    expect(result).toMatchObject({ pullRequest: { number: 42 } });
    expect(acli.calls().map((call) => call.args)).toEqual([AUTH_STATUS_ARGS, transitionArgs("TEST-5", "In Review")]);
    expect(eventsOf(fixture.dataRoot, KEY).at(-1)).toMatchObject({
      type: "tracker_update",
      data: { action: "review", result: "ok" },
    });
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "in_peer_review" });
  });

  it.each([
    { name: "without an in-progress label", updateOnStart: true, inProgressLabel: undefined, marked: true },
    { name: "when updateOnStart is false", updateOnStart: false, inProgressLabel: "wip", marked: true },
    { name: "when this task did not add the marker", updateOnStart: true, inProgressLabel: "wip", marked: false },
  ])("adds review $name without a clear", async ({ updateOnStart, inProgressLabel, marked }) => {
    const fixture = await pushedTask();
    Object.assign(fixture.config.repos[fixture.repoKey].issueTracker, {
      updateOnStart,
      inProgressLabel,
      reviewLabel: "peer-review",
    });
    const gh = fakeGh(useTempDir("tasker-open-pr-gated-clear-gh-"), fixture.env, [
      ghTokenAnswer("codeguru42", "gho_test"),
      githubWriteAnswer({
        project: "codeguru42/tasker",
        number: 5,
        verb: "edit",
        rest: ["--add-label", "peer-review"],
      }),
    ]);
    const { io } = await withDataRootStore(fixture.dataRoot, (store) => {
      if (marked) store.recordTrackerMark(fixture.task.id);
      return callOpenPr(fixture, store, forgeStub(), 300, { ...gh.env, PATH: fixture.env.PATH });
    });

    expect(gh.calls().map((call) => call.args)).toHaveLength(1);
    expect(io.out.join("")).toContain("peer-review");
    expect(
      eventsOf(fixture.dataRoot, KEY).filter(
        (event) => event.type === "tracker_update" && (event.data as { action: string }).action !== "in_progress",
      ),
    ).toMatchObject([{ data: { action: "review", result: "ok" } }]);
  });

  it("keeps the PR and review state when clearing the marker fails", async () => {
    const fixture = await pushedTask();
    Object.assign(fixture.config.repos[fixture.repoKey].issueTracker, {
      updateOnStart: true,
      inProgressLabel: "wip",
      reviewLabel: "peer-review",
    });
    const gh = fakeGh(useTempDir("tasker-open-pr-clear-fail-gh-"), fixture.env, [
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
        rest: ["--remove-label", "wip"],
        stderr: "denied",
        exitCode: 1,
      }),
    ]);
    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) => {
      store.recordTrackerMark(fixture.task.id);
      return callOpenPr(fixture, store, forgeStub(), 300, { ...gh.env, PATH: fixture.env.PATH });
    });

    expect(result).toMatchObject({ pullRequest: { number: 42 } });
    expect(io.err.join("")).toContain("warning: cannot clear the in-progress marker");
    expect(eventsOf(fixture.dataRoot, KEY).slice(-2)).toMatchObject([
      { data: { action: "review", result: "ok" } },
      { data: { action: "clear_in_progress", result: "failed" } },
    ]);
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 42 });
  });

  it("does not write to the tracker when there is no review target", async () => {
    const fixture = await pushedTask();
    const gh = fakeGh(useTempDir("tasker-open-pr-no-review-gh-"), fixture.env, [
      ghTokenAnswer("codeguru42", "gho_test"),
    ]);

    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) =>
      callOpenPr(fixture, store, forgeStub(), 300, { ...gh.env, PATH: fixture.env.PATH }),
    );

    expect(result).toMatchObject({ pullRequest: { number: 42 } });
    expect(gh.calls().map((call) => call.args)).toEqual([]);
    expect(io.out.join("")).toBe("");
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 42 });
  });

  it("adds review after recording the PR, then clears the GitHub marker", async () => {
    const fixture = await pushedTask();
    Object.assign(fixture.config.repos[fixture.repoKey].issueTracker, {
      updateOnStart: true,
      inProgressLabel: "wip",
      reviewLabel: "peer-review",
    });
    const fakeGhDir = useTempDir("tasker-open-pr-review-gh-");
    const gh = fakeGh(fakeGhDir, fixture.env, [
      ghTokenAnswer("codeguru42", "gho_test"),
      githubWriteAnswer({
        project: "codeguru42/tasker",
        number: 5,
        verb: "edit",
        rest: ["--add-label", "peer-review"],
      }),
      githubWriteAnswer({ project: "codeguru42/tasker", number: 5, verb: "edit", rest: ["--remove-label", "wip"] }),
    ]);
    const forge = forgeStub();

    const trackerEnv = { ...gh.env, PATH: fixture.env.PATH };
    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) => {
      store.recordTrackerMark(fixture.task.id);
      return callOpenPr(fixture, store, forge, 300, trackerEnv);
    });

    expect(result).toMatchObject({ adopted: false, pullRequest: { number: 42 } });
    expect(gh.calls().map((call) => call.args)).toEqual([
      ["issue", "edit", "5", "-R", "codeguru42/tasker", "--add-label", "peer-review"],
      ["issue", "edit", "5", "-R", "codeguru42/tasker", "--remove-label", "wip"],
    ]);
    expect(io.out.join("")).toBe(
      `added the label "peer-review" to ${KEY} on the tracker\ncleared the in-progress marker of ${KEY} on the tracker\n`,
    );
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 42 });
    expect(eventsOf(fixture.dataRoot, KEY).slice(-2)).toMatchObject([
      { type: "tracker_update", data: { action: "review", result: "ok" } },
      { type: "tracker_update", data: { action: "clear_in_progress", result: "ok" } },
    ]);
  });

  it("keeps the in-progress marker when the review add fails", async () => {
    const fixture = await pushedTask();
    Object.assign(fixture.config.repos[fixture.repoKey].issueTracker, {
      updateOnStart: true,
      inProgressLabel: "wip",
      reviewLabel: "peer-review",
    });
    const fakeGhDir = useTempDir("tasker-open-pr-review-fail-gh-");
    const gh = fakeGh(fakeGhDir, fixture.env, [
      ghTokenAnswer("codeguru42", "gho_test"),
      githubWriteAnswer({
        project: "codeguru42/tasker",
        number: 5,
        verb: "edit",
        rest: ["--add-label", "peer-review"],
        stderr: "label missing",
        exitCode: 1,
      }),
    ]);
    const forge = forgeStub();

    const trackerEnv = { ...gh.env, PATH: fixture.env.PATH };
    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) =>
      callOpenPr(fixture, store, forge, 300, trackerEnv),
    );

    expect(result).toMatchObject({ adopted: false, pullRequest: { number: 42 } });
    expect(gh.calls().map((call) => call.args)).toEqual([
      ["issue", "edit", "5", "-R", "codeguru42/tasker", "--add-label", "peer-review"],
    ]);
    expect(io.err.join("")).toContain(`warning: cannot add the label "peer-review" to ${KEY} on the tracker:`);
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 42 });
    expect(eventsOf(fixture.dataRoot, KEY).at(-1)).toMatchObject({
      type: "tracker_update",
      data: { action: "review", result: "failed" },
    });
  });

  it("refuses an accepted task before resolving its origin or calling the forge", async () => {
    const fixture = await useAcceptedTask({ repo: { forge: { provider: "github", account: "forge-team" } } });
    const fake = forgeStub();
    const before = eventsOf(fixture.dataRoot, KEY);

    const failure = await failureOf(
      withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake)),
      Error,
    );

    expect(failure.message).toContain("is in accepted; tasker open-pr needs pushed");
    expect(fake.calls).toEqual({ listed: [], created: [], ci: [], merged: [], queried: [], order: [] });
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("accepted");
    expect(eventsOf(fixture.dataRoot, KEY)).toEqual(before);
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("creates the PR with the stored title and exact body, then records the result", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub();
    const before = eventsOf(fixture.dataRoot, KEY);

    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake));

    expect(result).toEqual({ pullRequest: { number: 42, url: "https://example.test/pull/42" }, adopted: false });
    expect(fake.calls.created).toEqual([
      {
        cwd: fixture.task.worktreePath!,
        head: fixture.task.branch!,
        base: "main",
        title: `${fixture.task.title ?? KEY} (${KEY})`,
        body: `Task: ${KEY}\n\n${fixture.task.title ?? KEY}`,
      },
    ]);
    expect(fake.calls.listed).toEqual([{ cwd: fixture.task.worktreePath!, head: fixture.task.branch! }]);
    expect(io.out.join("")).toBe("");
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 42 });
    expect(eventsOf(fixture.dataRoot, KEY).slice(before.length)).toEqual([
      {
        type: "transition",
        data: { from: "pushed", to: "opening_pr" },
      },
      {
        type: "pr_opened",
        data: {
          number: 42,
          url: "https://example.test/pull/42",
          head: fixture.task.branch,
          base: "main",
          adopted: false,
          from: "opening_pr",
          to: "in_peer_review",
        },
      },
    ]);
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("adopts an open PR on the resolved base without creating another PR", async () => {
    const fixture = await pushedTask();
    Object.assign(fixture.config.repos[fixture.repoKey].issueTracker, { reviewLabel: "peer-review" });
    const gh = fakeGh(useTempDir("tasker-open-pr-adopt-review-gh-"), fixture.env, [
      ghTokenAnswer("codeguru42", "gho_test"),
      githubWriteAnswer({
        project: "codeguru42/tasker",
        number: 5,
        verb: "edit",
        rest: ["--add-label", "peer-review"],
      }),
    ]);
    const fake = forgeStub({
      openPrs: [{ number: 19, url: "https://example.test/pull/19", base: "main" }],
    });

    const { io } = await withDataRootStore(fixture.dataRoot, (store) =>
      callOpenPr(fixture, store, fake, 300, { ...gh.env, PATH: fixture.env.PATH }),
    );

    expect(fake.calls.created).toEqual([]);
    expect(gh.calls().map((call) => call.args)).toEqual([
      ["issue", "edit", "5", "-R", "codeguru42/tasker", "--add-label", "peer-review"],
    ]);
    expect(io.out.join("")).toBe(`added the label "peer-review" to ${KEY} on the tracker\n`);
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "in_peer_review", prNumber: 19 });
    expect(eventsOf(fixture.dataRoot, KEY).find((event) => event.type === "pr_opened")).toMatchObject({
      type: "pr_opened",
      data: { number: 19, adopted: true, base: "main" },
    });
  });

  it("refuses a different stored base before calling the forge", async () => {
    const fixture = await pushedTask();
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.task.id, { base: "refs/heads/topic" }));
    const fake = forgeStub();
    const before = eventsOf(fixture.dataRoot, KEY);

    const failure = await failureOf(
      withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake)),
      Error,
    );

    expect(failure.message).toContain("refs/heads/topic");
    expect(failure.message).toContain("main");
    expect(failure.message.toLowerCase()).toContain("correct");
    expect(fake.calls).toEqual({ listed: [], created: [], ci: [], merged: [], queried: [], order: [] });
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("pushed");
    expect(eventsOf(fixture.dataRoot, KEY)).toEqual(before);
  });

  it("refuses the stored base when origin now has a different default", async () => {
    const fixture = await pushedTask();
    await fixture.origin.createBranch("release");
    await runGit(["symbolic-ref", "HEAD", "refs/heads/release"], { gitDir: fixture.origin.path, env: fixture.env });
    const fake = forgeStub();
    const before = eventsOf(fixture.dataRoot, KEY);

    const failure = await failureOf(
      withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake)),
      Error,
    );

    expect(failure.message).toContain("has base main, but origin's default base is release");
    expect(fake.calls).toEqual({ listed: [], created: [], ci: [], merged: [], queried: [], order: [] });
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("pushed");
    expect(eventsOf(fixture.dataRoot, KEY)).toEqual(before);
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("refuses an unresolved origin default without querying the forge", async () => {
    const fixture = await pushedTask();
    await runGit(["symbolic-ref", "HEAD", "refs/heads/missing"], { gitDir: fixture.origin.path, env: fixture.env });
    const fake = forgeStub();
    const before = eventsOf(fixture.dataRoot, KEY);

    const failure = await failureOf(
      withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake)),
      Error,
    );

    expect(failure.message).toContain("origin's default base could not be resolved");
    expect(fake.calls).toEqual({ listed: [], created: [], ci: [], merged: [], queried: [], order: [] });
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("pushed");
    expect(eventsOf(fixture.dataRoot, KEY)).toEqual(before);
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("refuses required task data before calling the forge", async () => {
    for (const [field, value, message] of [
      ["branch", null, "has no branch"],
      ["worktreePath", null, "has no worktree"],
      ["base", null, "has no base"],
    ] as const) {
      const fixture = await pushedTask();
      withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.task.id, { [field]: value }));
      const fake = forgeStub();

      const failure = await failureOf(
        withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake)),
        Error,
      );

      expect(failure.message).toContain(message);
      expect(fake.calls).toEqual({ listed: [], created: [], ci: [], merged: [], queried: [], order: [] });
      expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("pushed");
    }
  });

  it("does not enter opening_pr when fetching origin fails", async () => {
    const fixture = await pushedTask();
    const hidden = `${fixture.origin.path}.hidden`;
    const fake = forgeStub();
    renameSync(fixture.origin.path, hidden);

    let failure: Error | undefined;
    try {
      failure = await failureOf(
        withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake)),
        Error,
      );
    } finally {
      renameSync(hidden, fixture.origin.path);
    }

    expect(failure?.message).toBeTruthy();
    expect(fake.calls).toEqual({ listed: [], created: [], ci: [], merged: [], queried: [], order: [] });
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("pushed");
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("uses the issue key when the stored title is absent", async () => {
    const fixture = await pushedTask();
    withDataRootStore(fixture.dataRoot, (store) => store.updateTask(fixture.task.id, { title: null }));
    const fake = forgeStub();

    await withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake));

    expect(fake.calls.created[0]).toMatchObject({ title: `${KEY} (${KEY})`, body: `Task: ${KEY}\n\n${KEY}` });
  });

  it("refuses an open PR on another base and gives its identity", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub({
      openPrs: [{ number: 28, url: "https://example.test/pull/28", base: "release" }],
    });

    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake));

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(
      `opening_pr failed: open PR #28 (https://example.test/pull/28) for ${fixture.task.branch!} has base release; correct that PR base and run tasker retry\n`,
    );
    expect(fake.calls.created).toEqual([]);
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("failed");
  });

  it("does not create a PR when lookup fails", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub();
    fake.failList(new Error("lookup denied"));

    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake));

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe("opening_pr failed: lookup denied\n");
    expect(fake.calls.created).toEqual([]);
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("failed");
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("fails opening when the forge cannot create a PR", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub();
    fake.failCreate(new Error("create denied"));

    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake));

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe("opening_pr failed: create denied\n");
    expect(latestTaskOf(fixture.dataRoot, KEY).state).toBe("failed");
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("fails the run if the PR record transaction fails and reports the created PR", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub();
    const releaseRejectedEvent = rejectPrOpenedEvent(databasePathOf(fixture.dataRoot));

    const { result, io } = await withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake));
    releaseRejectedEvent();

    expect(result).toEqual({ exitCode: 1 });
    expect(io.err.join("")).toBe(
      "opening_pr failed: opened PR #42 (https://example.test/pull/42), but tasker cannot record it: event rejected\n",
    );
    expect(latestTaskOf(fixture.dataRoot, KEY)).toMatchObject({ state: "failed", prNumber: null });
    expect(readRunMarker(databasePathOf(fixture.dataRoot), fixture.task.id)).toBeUndefined();
  });

  it("honors task and repo locks before contacting the forge", async () => {
    const fixture = await pushedTask();
    const fake = forgeStub();
    const dbPath = databasePathOf(fixture.dataRoot);
    const taskHolder = startLockHolder(dbPath, taskLockName(fixture.repoKey, KEY));
    await taskHolder.attempt;
    const taskFailure = await failureOf(
      withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake)),
      LockBusyError,
    );
    expect(taskFailure).toBeInstanceOf(LockBusyError);
    expect(fake.calls).toEqual({ listed: [], created: [], ci: [], merged: [], queried: [], order: [] });

    process.kill(taskHolder.pid, "SIGKILL");
    await taskHolder.exited;
    const repoHolder = startLockHolder(dbPath, repoLockName(fixture.repoKey));
    await repoHolder.attempt;
    const repoFailure = await failureOf(
      withDataRootStore(fixture.dataRoot, (store) => callOpenPr(fixture, store, fake, 0)),
      LockBusyError,
    );
    expect(repoFailure).toBeInstanceOf(LockBusyError);
    expect(fake.calls).toEqual({ listed: [], created: [], ci: [], merged: [], queried: [], order: [] });
    process.kill(repoHolder.pid, "SIGKILL");
    await repoHolder.exited;
  });
});
