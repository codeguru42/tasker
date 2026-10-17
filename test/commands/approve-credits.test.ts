import { describe, expect, it } from "vitest";
import { approveCredits } from "../../src/commands/approve-credits.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { plannedLine, resumedLine } from "../helpers/command-output.js";
import {
  argAfter,
  claudeApprovalWarningEvent,
  claudeOverageEvent,
  TEST_SESSION_ID,
  withEventBeforeResult,
  withEventFirst,
} from "../helpers/fake-claude.js";
import { answerStream, validPlanAnswer } from "../helpers/plan.js";
import { approvedCreditsLineExpected } from "../helpers/quota.js";
import { wrongStateError } from "../helpers/state-commands.js";
import { eventDataOf, latestTaskOf, seedCreditsApprovalIn, withDataRootStore } from "../helpers/store.js";
import {
  expectCommandRefused,
  expectNoAssistantRun,
  moveTaskThrough,
  pausePlanFixtureTask,
  usePlanFixture,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const RESETS_AT = 1792206000;
const OLD = 1791778800;
const ASK = { repo: { overagePolicy: "ask" } };

const runApprove = (key = KEY, ...extra: string[]) => runCommand(approveCredits, "approve-credits", key, ...extra);

describe("tasker approve-credits", () => {
  describe("a refusal before any write", () => {
    it("refuses a task in a state that approve-credits does not accept", async () => {
      const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
      withDataRootStore(fixture.started.dataRoot, (store) =>
        moveTaskThrough(store, store.findLatestTask(fixture.started.repoKey, KEY)!.id, [
          "planning",
          "awaiting_plan_review",
          "approved",
          "executing",
          "executed",
        ]),
      );

      await expectCommandRefused(
        fixture.started,
        () => runApprove(),
        `${wrongStateError("executed", KEY, "approve-credits", "quota_blocked or awaiting_quota_approval")}\n`,
      );

      expectNoAssistantRun(fixture);
    });

    it("refuses a stop at a subscription limit", async () => {
      const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
      pausePlanFixtureTask(fixture, "planning", "quota_blocked", { cause: "rate_limit", resetsAt: RESETS_AT });

      await expectCommandRefused(
        fixture.started,
        () => runApprove(),
        `the task of ${KEY} stopped at a subscription limit, and paid usage cannot continue it; run tasker resume ${KEY} after the reset\n`,
      );

      expectNoAssistantRun(fixture);
    });

    it("refuses a stop at the overage boundary that named no window", async () => {
      const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
      pausePlanFixtureTask(fixture, "planning", "quota_blocked", { cause: "overage" });

      await expectCommandRefused(
        fixture.started,
        () => runApprove(),
        `the task of ${KEY} stopped at the overage boundary, but the stop named no window, so an approval cannot hold; run tasker resume ${KEY} after the reset\n`,
      );

      expectNoAssistantRun(fixture);
    });

    it("refuses a warning pause from an origin with no step", async () => {
      const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
      pausePlanFixtureTask(fixture, "pushing", "awaiting_quota_approval");

      await expectCommandRefused(
        fixture.started,
        () => runApprove(),
        `the task of ${KEY} was paused from pushing; tasker approve-credits has no step for it\n`,
      );

      expectNoAssistantRun(fixture);
    });

    it("refuses an overage stop from verifying", async () => {
      const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
      pausePlanFixtureTask(fixture, "verifying", "quota_blocked", { cause: "overage", resetsAt: RESETS_AT });

      await expectCommandRefused(
        fixture.started,
        () => runApprove(),
        `the task of ${KEY} was paused from verifying; tasker approve-credits has no step for it\n`,
      );

      expectNoAssistantRun(fixture);
    });
  });

  it("approves the window of a warning pause, runs the plan again and does not pause", async () => {
    const fixture = await usePlanFixture(
      { stream: withEventBeforeResult(claudeApprovalWarningEvent(), answerStream(validPlanAnswer())) },
      ASK,
    );
    const { dataRoot } = fixture.started;
    pausePlanFixtureTask(fixture, "planning", "awaiting_quota_approval", { utilization: 0.95, resetsAt: RESETS_AT });

    const result = await runApprove();

    expect(result.code).toBe(0);
    expect(
      result.out.startsWith(
        approvedCreditsLineExpected(KEY, RESETS_AT) + resumedLine(KEY, "planning", "workspace_ready"),
      ),
    ).toBe(true);
    expect(result.out).toContain(plannedLine(KEY, 1));
    expect(eventDataOf(dataRoot, KEY, "credits_approved")).toEqual([{ resetsAt: RESETS_AT }]);
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--resume")).toBe(TEST_SESSION_ID);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
  });

  it("records no event for a warning pause that named no window", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
    const { dataRoot } = fixture.started;
    pausePlanFixtureTask(fixture, "planning", "awaiting_quota_approval");

    const result = await runApprove();

    expect(result.code).toBe(0);
    expect(
      result.out.startsWith(approvedCreditsLineExpected(KEY) + resumedLine(KEY, "planning", "workspace_ready")),
    ).toBe(true);
    expect(result.out).toContain(plannedLine(KEY, 1));
    expect(eventDataOf(dataRoot, KEY, "credits_approved")).toEqual([]);
  });

  it("continues a stop at the overage boundary under decline", async () => {
    const fixture = await usePlanFixture({
      stream: withEventFirst(claudeOverageEvent(), answerStream(validPlanAnswer())),
    });
    const { dataRoot } = fixture.started;
    pausePlanFixtureTask(fixture, "planning", "quota_blocked", { cause: "overage", resetsAt: RESETS_AT });

    const result = await runApprove();

    expect(result.code).toBe(0);
    expect(eventDataOf(dataRoot, KEY, "credits_approved")).toEqual([{ resetsAt: RESETS_AT }]);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
  });

  it("lets a later approval replace an earlier one", async () => {
    const fixture = await usePlanFixture(
      { stream: withEventBeforeResult(claudeApprovalWarningEvent(), answerStream(validPlanAnswer())) },
      ASK,
    );
    const { dataRoot } = fixture.started;
    pausePlanFixtureTask(fixture, "planning", "awaiting_quota_approval", { utilization: 0.95, resetsAt: RESETS_AT });
    seedCreditsApprovalIn(dataRoot, latestTaskOf(dataRoot, KEY).id, OLD);

    const result = await runApprove();

    expect(result.code).toBe(0);
    expect(eventDataOf(dataRoot, KEY, "credits_approved")).toEqual([{ resetsAt: OLD }, { resetsAt: RESETS_AT }]);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
  });

  it("keeps the approval when the next command fails", async () => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()), exitCode: 1, stderr: "boom" }, ASK);
    const { dataRoot } = fixture.started;
    pausePlanFixtureTask(fixture, "planning", "awaiting_quota_approval", { utilization: 0.95, resetsAt: RESETS_AT });

    const result = await runApprove();

    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^planning failed: .+\n$/);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("failed");
    expect(eventDataOf(dataRoot, KEY, "credits_approved")).toEqual([{ resetsAt: RESETS_AT }]);
  });

  it("prints the description of the command and of its repo option for --help", async () => {
    const { code, help } = await runHelp(approveCredits, "approve-credits");

    expect(code).toBe(0);
    expect(help).toContain(
      "Continue a task in awaiting_quota_approval, or in quota_blocked at the overage boundary, approve paid usage in its quota window, and run the same command again",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
