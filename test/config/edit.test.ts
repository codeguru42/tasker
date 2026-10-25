import { describe, expect, it } from "vitest";
import { setRoleModel, setSessionRoleModel } from "../../src/config/edit.js";
import { validConfig } from "../helpers/config.js";

// The raw configuration with extra keys in a non-default order, and a second repo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawConfig(): Record<string, any> {
  const raw = validConfig();
  raw.repos.other = structuredClone(raw.repos.tasker);
  return { retentionDays: 7, ...raw, zeta: true };
}

function pretty(raw: unknown, end = "\n"): string {
  return `${JSON.stringify(raw, null, 2)}${end}`;
}

describe("setRoleModel", () => {
  it("changes the model and the effort of one role only", () => {
    const expected = rawConfig();
    expected.repos.tasker.assistant.models.plan = { model: "claude-opus-5-5", effort: "low" };

    const result = setRoleModel(pretty(rawConfig()), "tasker", "plan", {
      model: "claude-opus-5-5",
      effort: "low",
    });

    expect(result).toBe(pretty(expected));
  });

  it("keeps the model when only the effort is given", () => {
    const expected = rawConfig();
    expected.repos.tasker.assistant.models.review.effort = "low";

    const result = setRoleModel(pretty(rawConfig()), "tasker", "review", { effort: "low" });

    expect(result).toBe(pretty(expected));
  });

  it("keeps the effort when only the model is given", () => {
    const expected = rawConfig();
    expected.repos.tasker.assistant.models.execute.model = "haiku";

    const result = setRoleModel(pretty(rawConfig()), "tasker", "execute", { model: "haiku" });

    expect(result).toBe(pretty(expected));
  });

  it("keeps a text without a final line end without one", () => {
    const result = setRoleModel(pretty(rawConfig(), ""), "tasker", "plan", { effort: "low" });

    expect(result.endsWith("}")).toBe(true);
  });

  it("keeps a final line end of \\r\\n", () => {
    const result = setRoleModel(pretty(rawConfig(), "\r\n"), "tasker", "plan", { effort: "low" });

    expect(result.endsWith("}\r\n")).toBe(true);
  });

  it("adds no default key", () => {
    const text = pretty(validConfig());

    const result = JSON.parse(setRoleModel(text, "tasker", "plan", { effort: "low" }));

    expect(Object.keys(result)).toEqual(Object.keys(validConfig()));
    expect(result).not.toHaveProperty("bootstrap");
    expect(result).not.toHaveProperty("retentionDays");
  });

  it("does not change the other repos", () => {
    const result = JSON.parse(setRoleModel(pretty(rawConfig()), "tasker", "plan", { model: "haiku", effort: "low" }));

    expect(result.repos.other).toEqual(rawConfig().repos.other);
  });

  it("throws for a repo key that has no repo", () => {
    expect(() => setRoleModel(pretty(rawConfig()), "missing", "plan", { effort: "low" })).toThrow(Error);
  });
});

describe("setSessionRoleModel", () => {
  it("adds the keys sessions and models when the repo has no sessions key", () => {
    const expected = rawConfig();
    expected.repos.tasker.sessions = { models: { operator: { model: "opus", effort: "xhigh" } } };

    const result = setSessionRoleModel(pretty(rawConfig()), "tasker", "operator", {
      model: "opus",
      effort: "xhigh",
    });

    expect(result).toBe(pretty(expected));
  });

  it("adds the key models when sessions has only the kind", () => {
    const input = rawConfig();
    input.repos.tasker.sessions = { kind: "claude" };
    const expected = rawConfig();
    expected.repos.tasker.sessions = {
      kind: "claude",
      models: { planner: { model: "opus", effort: "high" } },
    };

    const result = setSessionRoleModel(pretty(input), "tasker", "planner", { model: "opus", effort: "high" });

    expect(result).toBe(pretty(expected));
  });

  it("changes only the effort of a role with an entry", () => {
    const input = rawConfig();
    input.repos.tasker.sessions = { models: { orchestrator: { model: "sonnet", effort: "low" } } };
    const expected = rawConfig();
    expected.repos.tasker.sessions = { models: { orchestrator: { model: "sonnet", effort: "max" } } };

    const result = setSessionRoleModel(pretty(input), "tasker", "orchestrator", { effort: "max" });

    expect(result).toBe(pretty(expected));
  });

  it("does not change the other repos", () => {
    const result = JSON.parse(
      setSessionRoleModel(pretty(rawConfig()), "tasker", "operator", { model: "opus", effort: "high" }),
    );

    expect(result.repos.other).toEqual(rawConfig().repos.other);
  });

  it("keeps a final line end of \\r\\n", () => {
    const result = setSessionRoleModel(pretty(rawConfig(), "\r\n"), "tasker", "operator", {
      model: "opus",
      effort: "high",
    });

    expect(result.endsWith("}\r\n")).toBe(true);
  });

  it("throws for a repo key that has no repo", () => {
    expect(() =>
      setSessionRoleModel(pretty(rawConfig()), "missing", "operator", { model: "opus", effort: "high" }),
    ).toThrow("the configuration has no object at");
  });
});
