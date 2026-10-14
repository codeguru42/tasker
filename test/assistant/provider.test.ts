import { describe, expect, it } from "vitest";
import { assistantDoctorChecks, createAssistantProvider, createSessionProvider } from "../../src/assistant/provider.js";
import { parseConfig } from "../../src/config/schema.js";
import { configIssuesOf, validConfig } from "../helpers.js";

const unavailableIds = ["copilot", "pi"] as const;
type Id = "claude-code" | (typeof unavailableIds)[number];

function repoWith(provider: Id) {
  const repo = parseConfig(validConfig(), {}, "/home/me").repos.tasker;
  return { ...repo, assistant: { ...repo.assistant, provider } };
}

const unavailable = (key: string, id: string) => [
  `repos.${key}.assistant.provider: the ${id} assistant is not available in this version`,
];

describe("createAssistantProvider", () => {
  it.each(unavailableIds)("throws a ConfigError for the %s assistant", (id) => {
    expect(configIssuesOf(() => createAssistantProvider("tasker", repoWith(id), "plan"))).toEqual(
      unavailable("tasker", id),
    );
  });

  it("gives the claude-code provider with the model and the effort of the role", () => {
    const selected = createAssistantProvider("tasker", repoWith("claude-code"), "execute");

    expect(selected.provider.id).toBe("claude-code");
    expect({ model: selected.model, effort: selected.effort }).toEqual({ model: "sonnet", effort: "medium" });
  });

  it("names the repo key in the path of the issue", () => {
    const [issue] = configIssuesOf(() => createAssistantProvider("a/b", repoWith("copilot"), "plan"));
    expect(issue).toMatch(/^repos\.a\/b\.assistant\.provider:/);
  });
});

describe("createSessionProvider", () => {
  it.each(unavailableIds)("throws a ConfigError for the recorded %s assistant", (id) => {
    expect(
      configIssuesOf(() => createSessionProvider({ repoKey: "tasker", provider: id, model: "x", effort: "low" })),
    ).toEqual(unavailable("tasker", id));
  });

  it("gives the claude-code provider with the recorded model and effort", () => {
    const selected = createSessionProvider({
      repoKey: "tasker",
      provider: "claude-code",
      model: "opus[1m]",
      effort: "low",
    });

    expect(selected.provider.id).toBe("claude-code");
    expect({ model: selected.model, effort: selected.effort }).toEqual({ model: "opus[1m]", effort: "low" });
  });
});

function configWith(providers: Record<string, Id>) {
  const config = parseConfig(validConfig(), {}, "/home/me");
  return {
    ...config,
    repos: Object.fromEntries(Object.entries(providers).map(([key, id]) => [key, repoWith(id)])),
  };
}

describe("assistantDoctorChecks", () => {
  it("gives one claude version check for two claude-code repos", () => {
    const checks = assistantDoctorChecks(configWith({ a: "claude-code", b: "claude-code" }));

    expect(checks.map((check) => check.name)).toEqual(["claude version"]);
  });

  it("gives no checks for a configuration with no repo", () => {
    expect(assistantDoctorChecks(configWith({}))).toEqual([]);
  });

  it("throws the ConfigError of the pick for a copilot repo", () => {
    expect(configIssuesOf(() => assistantDoctorChecks(configWith({ a: "claude-code", c: "copilot" })))).toEqual(
      unavailable("c", "copilot"),
    );
  });
});
