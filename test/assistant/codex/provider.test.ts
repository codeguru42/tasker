import { describe, expect, it, vi } from "vitest";
import { createCodexProvider } from "../../../src/assistant/codex/provider.js";
import type { AssistantProvider } from "../../../src/assistant/provider.js";
import { parseConfig } from "../../../src/config/schema.js";
import { validConfig } from "../../helpers/config.js";
import { TEST_SESSION_ID, runInput } from "../../helpers/fake-claude.js";
import { CODEX_VERSION_ARGS, useFakeCodex } from "../../helpers/fake-codex.js";

function codexProvider(): AssistantProvider {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return createCodexProvider();
}

const repo = () => {
  const tasker = parseConfig(validConfig(), {}, "/home/me").repos.tasker;
  return { key: "tasker", assistant: { ...tasker.assistant, provider: "codex" as const } };
};

describe("createCodexProvider", () => {
  it("has the id codex", () => {
    expect(codexProvider().id).toBe("codex");
  });

  it("refuses a run and starts no child", async () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS }]);
    const onSpawn = vi.fn();

    const outcome = await codexProvider().run(runInput({ env: fake.env, onSpawn }));

    expect(outcome).toEqual({
      kind: "failure",
      sessionId: TEST_SESSION_ID,
      events: [],
      permissionDenials: [],
      usage: "unavailable",
      exitCode: null,
      signal: null,
      reason: "the codex assistant cannot run a task in this version",
    });
    expect(fake.calls()).toEqual([]);
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it("gives no doctor check for no repo", () => {
    expect(codexProvider().doctorChecks([])).toEqual([]);
  });

  it.each([1, 2])("gives the version and login checks once for %i repos", (count) => {
    const repos = Array.from({ length: count }, () => repo());

    expect(
      codexProvider()
        .doctorChecks(repos)
        .map((check) => check.name),
    ).toEqual(["codex version", "codex login"]);
  });

  it("gives no model check", () => {
    expect(codexProvider().modelChecks("gpt-5")).toEqual([]);
  });

  it("has no quota behavior", async () => {
    const provider = codexProvider();
    const outcome = await provider.run(runInput());

    expect(provider.detectQuotaApprovalWarning(outcome, 0.9)).toBeUndefined();
    expect(provider.isQuotaEvent({})).toBe(false);
    expect(provider.shouldSuppressQuotaApprovalPause({ utilization: 0.95 }, 1)).toBe(false);
  });
});
