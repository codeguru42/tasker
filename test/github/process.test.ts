import { describe, expect, it } from "vitest";
import { runGhProcess } from "../../src/github/process.js";
import { fakeGh } from "../helpers/fake-gh.js";
import { useTempDir } from "../helpers/temp.js";

describe("the shared gh process", () => {
  it("uses the selected executable and captures both streams", async () => {
    const dir = useTempDir("tasker-shared-gh-");
    const fake = fakeGh(dir, {}, [{ args: ["api", "user"], stdout: "answer", stderr: "detail" }]);

    await expect(runGhProcess(["api", "user"], fake.env)).resolves.toMatchObject({
      code: 0,
      stdout: "answer",
      stderr: "detail",
    });
    expect(fake.calls().map((call) => call.args)).toEqual([["api", "user"]]);
  });

  it("reports a safe command error with captured details", async () => {
    const dir = useTempDir("tasker-shared-gh-error-");
    const fake = fakeGh(dir, {}, [{ args: ["api", "user"], stderr: "denied", exitCode: 7 }]);

    await expect(runGhProcess(["api", "user"], fake.env)).rejects.toMatchObject({
      name: "GhProcessError",
      subcommand: "api user",
      stdout: "",
      stderr: "denied",
      exitCode: 7,
    });
  });

  it("reports a missing worktree before starting gh", async () => {
    const dir = useTempDir("tasker-shared-gh-cwd-");
    const fake = fakeGh(dir, {}, []);
    const missing = `${dir}/missing-worktree`;

    await expect(runGhProcess(["api", "user"], fake.env, { cwd: missing })).rejects.toThrow(missing);
    expect(fake.calls()).toEqual([]);
  });
});
