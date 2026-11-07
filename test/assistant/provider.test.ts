import { describe, expect, it } from "vitest";
import { assistantDoctorChecks, createAssistantProvider, createSessionProvider } from "../../src/assistant/provider.js";
import { parseConfig } from "../../src/config/schema.js";
import { validConfig } from "../helpers/config.js";
import { configIssuesOf } from "../helpers/errors.js";

const unavailableIds = ["copilot"] as const;
type Id = "claude-code" | "codex" | "pi" | (typeof unavailableIds)[number];

function repoWith(provider: Id) {
  const raw = validConfig();
  raw.repos.tasker.assistant.provider = provider;
  if (provider === "pi") {
    raw.repos.tasker.assistant.models.plan.model = "openrouter/auto";
    raw.repos.tasker.assistant.models.execute.model = "openrouter/auto";
    raw.repos.tasker.assistant.models.review.model = "openrouter/auto";
  }
  return parseConfig(raw, {}, "/home/me").repos.tasker;
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

  it("gives the codex provider", () => {
    const selected = createAssistantProvider("tasker", repoWith("codex"), "plan");

    expect(selected.provider.id).toBe("codex");
  });

  it("gives the pi provider with the model and effort of the role", () => {
    const selected = createAssistantProvider("tasker", repoWith("pi"), "review");

    expect(selected.provider.id).toBe("pi");
    expect({ model: selected.model, effort: selected.effort }).toEqual({ model: "opus", effort: "high" });
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

it("gives the codex provider for a recorded session", () => {
  const selected = createSessionProvider({ repoKey: "tasker", provider: "codex", model: "gpt-5", effort: "low" });

  expect(selected.provider.id).toBe("codex");
});

it("gives the pi provider for a recorded session", () => {
  const selected = createSessionProvider({
    repoKey: "tasker",
    provider: "pi",
    model: "openrouter/auto",
    effort: "low",
  });

  expect(selected.provider.id).toBe("pi");
  expect({ model: selected.model, effort: selected.effort }).toEqual({ model: "openrouter/auto", effort: "low" });
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

    expect(checks.map((check) => check.name)).toEqual([
      "claude version",
      ...(process.platform === "linux" ? ["sandbox: bwrap", "sandbox: socat"] : []),
    ]);
  });

  it.each<Record<string, Id>>([{ a: "codex" }, { a: "codex", b: "codex" }])(
    "gives the codex checks once for %j",
    (providers) => {
      const checks = assistantDoctorChecks(configWith(providers));

      expect(checks.map((check) => check.name)).toEqual(["codex version", "codex login"]);
    },
  );

  it("gives no checks for a configuration with no repo", () => {
    expect(assistantDoctorChecks(configWith({}))).toEqual([]);
  });

  it("throws the ConfigError of the pick for a copilot repo", () => {
    expect(configIssuesOf(() => assistantDoctorChecks(configWith({ a: "claude-code", c: "copilot" })))).toEqual(
      unavailable("c", "copilot"),
    );
  });
});
