import { describe, expect, it } from "vitest";
import { createAssistantProvider, createSessionProvider } from "../../src/assistant/provider.js";
import { parseConfig } from "../../src/config/schema.js";
import { configIssuesOf, validConfig } from "../helpers.js";

const ids = ["claude-code", "copilot", "pi"] as const;

function repoWith(provider: (typeof ids)[number]) {
  const repo = parseConfig(validConfig(), {}, "/home/me").repos.tasker;
  return { ...repo, assistant: { ...repo.assistant, provider } };
}

const unavailable = (key: string, id: string) => [
  `repos.${key}.assistant.provider: the ${id} assistant is not available in this version`,
];

describe("createAssistantProvider", () => {
  it.each(ids)("throws a ConfigError for the %s assistant", (id) => {
    expect(configIssuesOf(() => createAssistantProvider("tasker", repoWith(id), "plan"))).toEqual(
      unavailable("tasker", id),
    );
  });

  it("names the repo key in the path of the issue", () => {
    const [issue] = configIssuesOf(() => createAssistantProvider("a/b", repoWith("claude-code"), "plan"));
    expect(issue).toMatch(/^repos\.a\/b\.assistant\.provider:/);
  });
});

describe("createSessionProvider", () => {
  it.each(ids)("throws a ConfigError for the recorded %s assistant", (id) => {
    expect(
      configIssuesOf(() => createSessionProvider({ repoKey: "tasker", provider: id, model: "x", effort: "low" })),
    ).toEqual(unavailable("tasker", id));
  });
});
