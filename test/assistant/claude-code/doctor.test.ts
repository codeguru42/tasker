import { describe, expect, it } from "vitest";
import { claudeModelCheck, claudeVersionCheck } from "../../../src/assistant/claude-code/doctor.js";
import { createClaudeCodeProvider } from "../../../src/assistant/claude-code/provider.js";
import { useFakeClaude, useTempDir, validConfig } from "../../helpers.js";

const VERSION = "2.1.299 (Claude Code)";

describe("claudeVersionCheck", () => {
  it("has the name, required and timeoutMs of the version check", () => {
    const check = claudeVersionCheck();

    expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual({
      name: "claude version",
      required: true,
      timeoutMs: 5000,
    });
  });

  it("gives ok with the first line of the version", async () => {
    const fake = useFakeClaude({ version: { stdout: `${VERSION}\nmore\n` } });

    expect(await claudeVersionCheck().run(fake.env)).toEqual({ status: "ok", detail: VERSION });
    expect(fake.calls().map((call) => call.argv)).toEqual([["--version"]]);
  });

  it("gives the fix when claude is not installed", async () => {
    const emptyBin = useTempDir("tasker-empty-bin-");

    expect(await claudeVersionCheck().run({ PATH: emptyBin })).toEqual({
      status: "error",
      detail: "claude is not installed or not on PATH",
      remediation: "Install Claude Code and put claude on PATH.",
    });
  });

  it("gives no fix for a non-zero exit", async () => {
    const fake = useFakeClaude({ version: { stdout: "", stderr: "broken install\nsecond\n", exitCode: 3 } });

    const result = await claudeVersionCheck().run(fake.env);

    expect(result).toEqual({ status: "error", detail: "claude --version exited 3: broken install" });
  });

  it("gives the exit code alone when stderr is empty", async () => {
    const fake = useFakeClaude({ version: { stdout: "", exitCode: 3 } });

    expect(await claudeVersionCheck().run(fake.env)).toEqual({
      status: "error",
      detail: "claude --version exited 3",
    });
  });

  it("gives the timeout result when claude is slow", async () => {
    const fake = useFakeClaude({ version: { stdout: VERSION, sleepMs: 5000 } });

    expect(await claudeVersionCheck(300).run(fake.env)).toEqual({
      status: "error",
      detail: "the check did not finish in 300 ms",
    });
  });
});

describe("claudeModelCheck", () => {
  it("has the name, required and timeoutMs of the model check", () => {
    const check = claudeModelCheck("opus");

    expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual({
      name: "claude model: opus",
      required: true,
      timeoutMs: 1000,
    });
  });

  it("gives ok for a claude-code model", async () => {
    expect(await claudeModelCheck("opus").run({})).toEqual({
      status: "ok",
      detail: "opus is a claude-code model",
    });
  });

  it("gives the model error for another model", async () => {
    expect(await claudeModelCheck("gpt-4").run({})).toEqual({
      status: "error",
      detail: "is not a claude-code model: gpt-4",
    });
  });
});

describe("the claude-code provider checks", () => {
  const repos = [{ key: "tasker", assistant: validConfig()["repos"]["tasker"]["assistant"] }];

  it("gives no check for no repo", () => {
    expect(createClaudeCodeProvider().doctorChecks([])).toEqual([]);
  });

  it("gives one version check for the repos", () => {
    const checks = createClaudeCodeProvider().doctorChecks([...repos, { ...repos[0]!, key: "other" }]);

    expect(checks.map((check) => check.name)).toEqual(["claude version"]);
  });

  it("gives one model check for a model", () => {
    expect(createClaudeCodeProvider().modelChecks("opus").map((check) => check.name)).toEqual([
      "claude model: opus",
    ]);
  });
});
