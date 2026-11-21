import { describe, expect, it, vi } from "vitest";
import { createGitProvider } from "../../../src/vcs/git/provider.js";
import { readPromptTemplate } from "../../../src/prompts/template-file.js";
import { useTempDir } from "../../helpers/temp.js";

vi.mock("../../../src/prompts/template-file.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/prompts/template-file.js")>();
  return { ...original, readPromptTemplate: vi.fn(original.readPromptTemplate) };
});

const surface = () =>
  createGitProvider({ remote: "unused", config: {} }).assistantSurface({
    dataRoot: useTempDir("tasker-surface-"),
    repoKey: "codeguru42/tasker",
    env: process.env,
  });

const commitRulesReads = (): number =>
  vi.mocked(readPromptTemplate).mock.calls.filter(([path]) => path.endsWith("commit-rules.md")).length;

describe("the commit rules file", () => {
  it("is read only at the first use of executeCommitText", () => {
    const built = surface();
    expect(commitRulesReads()).toBe(0);
    expect(built.executeCommitText).toContain("{{BASE_REF}}");
    expect(commitRulesReads()).toBe(1);
  });
});
