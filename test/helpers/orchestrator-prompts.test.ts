import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packagePath } from "../../src/package-path.js";
import { markdownSection } from "./doc-text.js";
import { handoffPromptRead, orchestratorDocWordRuns, promptWordCount } from "./orchestrator-prompts.js";

describe("handoffPromptRead", () => {
  it("gives the prompt-read sentence with the role index", () => {
    const text = handoffPromptRead("docs/planner.md");
    expect(text.startsWith("Run git branch --show-current.")).toBe(true);
    expect(text).toContain("Then read AGENTS.md and docs/planner.md as its doc-read rule says.");
    expect(text.endsWith("with git show origin/main:<path>.")).toBe(true);
    expect(text).not.toContain("<role index>");
    expect(text).not.toContain("`");
  });
});

describe("promptWordCount", () => {
  it("counts the words", () => {
    expect(promptWordCount("one two three")).toBe(3);
  });

  it("leaves out the prompt-read sentence", () => {
    expect(promptWordCount(`${handoffPromptRead("docs/orchestrator.md")}\nfour five`)).toBe(2);
  });
});

describe("orchestratorDocWordRuns", () => {
  const section = markdownSection(readFileSync(packagePath("docs/orchestrator.md"), "utf8"), "The board watch job");

  it("gives no run for the prompt-read sentence", () => {
    expect(orchestratorDocWordRuns(handoffPromptRead("docs/orchestrator.md"))).toEqual([]);
  });

  it("gives a run that the board watch section holds", () => {
    const run = (section ?? "").split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
    expect(orchestratorDocWordRuns(run)).toEqual([run]);
  });

  it("gives no run for unrelated words", () => {
    expect(orchestratorDocWordRuns("a b c d e f g h")).toEqual([]);
  });
});
