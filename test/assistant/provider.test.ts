import { describe, expect, it } from "vitest";
import { assistantDoctorChecks, createAssistantProvider, createSessionProvider } from "../../src/assistant/provider.js";
import { parseConfig } from "../../src/config/schema.js";
import { checkSummaries } from "../helpers/doctor.js";
import { validConfig } from "../helpers/config.js";
import { configIssuesOf } from "../helpers/errors.js";
import { REPORTED_PI_MODEL, ROUTER_PI_MODEL } from "../helpers/pi-provider.js";

const unavailableIds = ["copilot"] as const;
type Id = "claude-code" | "codex" | "pi" | (typeof unavailableIds)[number];

function repoWith(provider: Id) {
  const raw = validConfig();
  raw.repos.tasker.assistant.provider = provider;
  if (provider === "pi") {
    raw.repos.tasker.assistant.models.plan.model = "openrouter/auto";
    raw.repos.tasker.assistant.models.execute.model = "openrouter/auto";
    raw.repos.tasker.assistant.models.review.model = "openrouter/review";
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
    expect({ model: selected.model, effort: selected.effort }).toEqual({ model: "openrouter/review", effort: "high" });
  });

  it("names the repo key in the path of the issue", () => {
    const [issue] = configIssuesOf(() => createAssistantProvider("a/b", repoWith("copilot"), "plan"));
    expect(issue).toMatch(/^repos\.a\/b\.assistant\.provider:/);
  });
});

describe("createSessionProvider", () => {
  it.each(unavailableIds)("throws a ConfigError for the recorded %s assistant", (id) => {
    expect(
      configIssuesOf(() =>
        createSessionProvider({ repoKey: "tasker", provider: id, model: "x", effort: "low", trustedExtensions: [] }),
      ),
    ).toEqual(unavailable("tasker", id));
  });

  it("gives the claude-code provider with the recorded model and effort", () => {
    const selected = createSessionProvider({
      repoKey: "tasker",
      provider: "claude-code",
      model: "opus[1m]",
      effort: "low",
      trustedExtensions: [],
    });

    expect(selected.provider.id).toBe("claude-code");
    expect({ model: selected.model, effort: selected.effort }).toEqual({ model: "opus[1m]", effort: "low" });
  });
});

it("gives the codex provider for a recorded session", () => {
  const selected = createSessionProvider({
    repoKey: "tasker",
    provider: "codex",
    model: "gpt-5",
    effort: "low",
    trustedExtensions: [],
  });

  expect(selected.provider.id).toBe("codex");
});

it("gives the pi provider for a recorded session", () => {
  const selected = createSessionProvider({
    repoKey: "tasker",
    provider: "pi",
    model: "openrouter/auto",
    effort: "low",
    trustedExtensions: [],
  });

  expect(selected.provider.id).toBe("pi");
  expect({ model: selected.model, effort: selected.effort }).toEqual({ model: "openrouter/auto", effort: "low" });
});

describe("createSessionProvider with a reported model", () => {
  const recorded = (provider: "claude-code" | "codex" | "pi", model: string, reportedModel?: string) => ({
    repoKey: "tasker",
    provider,
    model,
    effort: "low" as const,
    trustedExtensions: [],
    ...(reportedModel === undefined ? {} : { reportedModel }),
  });

  it("gives pi the reported model", () => {
    expect(createSessionProvider(recorded("pi", ROUTER_PI_MODEL, REPORTED_PI_MODEL)).model).toBe(REPORTED_PI_MODEL);
  });

  it("gives pi the recorded model when pi reported none", () => {
    expect(createSessionProvider(recorded("pi", ROUTER_PI_MODEL)).model).toBe(ROUTER_PI_MODEL);
  });

  it.each([
    ["claude-code", "opus"],
    ["codex", "gpt-5"],
  ] as const)("gives %s the recorded model", (provider, model) => {
    expect(createSessionProvider(recorded(provider, model, "other-model")).model).toBe(model);
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

  it("selects pi checks and keeps each upstream in first-use order", () => {
    const checks = assistantDoctorChecks(configWith({ a: "pi", b: "pi" }));

    expect(checkSummaries(checks)).toEqual([
      { name: "pi version", required: true, timeoutMs: 5000 },
      ...(process.platform === "linux" ? [{ name: "sandbox: bwrap", required: true, timeoutMs: 1000 }] : []),
      { name: "pi-auth:openrouter", required: true, timeoutMs: 10000 },
      { name: "superpowers:pi", required: true, timeoutMs: 5000 },
      { name: "simple-english:pi", required: true, timeoutMs: 1000 },
    ]);
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
