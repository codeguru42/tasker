import { describe, expect, it, vi } from "vitest";
import { createPiProvider } from "../../helpers/pi-provider.js";
import { TEST_SESSION_ID, runInput } from "../../helpers/fake-claude.js";

describe("createPiProvider", () => {
  it.each([
    [
      "a relative custom folder",
      { TASKER_PI_CODING_AGENT_DIR: "rel/x" },
      "TASKER_PI_CODING_AGENT_DIR must be an absolute path, got rel/x",
    ],
    ["a relative HOME", { HOME: "rel/h" }, "HOME must be an absolute path, got rel/h"],
    ["a missing HOME", {}, "tasker cannot find the agent folder of pi, because HOME is not set"],
  ])("refuses %s before it starts a child", async (_name, env, reason) => {
    const onSpawn = vi.fn();
    const outcome = await createPiProvider().run(runInput({ env, onSpawn }));

    expect(outcome).toEqual({
      kind: "failure",
      sessionId: TEST_SESSION_ID,
      events: [],
      permissionDenials: [],
      usage: "unavailable",
      exitCode: null,
      signal: null,
      reason,
    });
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it("refuses a task run with a valid agent folder before it starts a child", async () => {
    const onSpawn = vi.fn();
    const outcome = await createPiProvider().run(runInput({ env: { HOME: "/home/user" }, onSpawn }));

    expect(outcome).toEqual({
      kind: "failure",
      sessionId: TEST_SESSION_ID,
      events: [],
      permissionDenials: [],
      usage: "unavailable",
      exitCode: null,
      signal: null,
      reason: "the pi assistant cannot run a task in this version",
    });
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it("checks whether a model is a pi model", async () => {
    const checks = createPiProvider().modelChecks("openrouter/auto");

    expect(checks).toHaveLength(1);
    expect(checks[0].name).toBe("pi model: openrouter/auto");
    expect(await checks[0].run({})).toEqual({
      status: "ok",
      detail: "openrouter/auto is a pi model",
    });
  });

  it("has no quota behavior", () => {
    const provider = createPiProvider();

    expect(
      provider.detectQuotaApprovalWarning(
        {
          kind: "success",
          sessionId: TEST_SESSION_ID,
          events: [],
          permissionDenials: [],
          usage: "unavailable",
        },
        0.9,
      ),
    ).toBeUndefined();
    expect(provider.isQuotaEvent({})).toBe(false);
    expect(provider.shouldSuppressQuotaApprovalPause({ utilization: 0.95 }, 1)).toBe(false);
  });
});
