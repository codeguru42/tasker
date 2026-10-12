import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitVersionCheck } from "../../../src/vcs/git/doctor.js";
import { gitTestEnv, makeTempDir, writeFakeGit } from "../../helpers.js";

describe("gitVersionCheck", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = makeTempDir("tasker-doctor-version-");
    env = gitTestEnv(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Runs the check with a fake git that prints output as its version.
  function runWithFakeGit(output: string, timeoutMs?: number) {
    const binDir = join(dir, "bin");
    writeFakeGit(binDir, `echo '${output}'`);
    return gitVersionCheck(timeoutMs).run({ ...env, PATH: binDir });
  }

  it("has the name, the required flag and the time limit", () => {
    const check = gitVersionCheck();
    expect(check.name).toBe("git version");
    expect(check.required).toBe(true);
    expect(check.timeoutMs).toBe(5000);
  });

  it.each([
    ["git version 2.47.3", "2.47.3"],
    ["git version 2.47.3.windows.1", "2.47.3.windows.1"],
    ["git version 2.39.5 (Apple Git-154)", "2.39.5"],
    ["git version 2.47.0.rc1", "2.47.0.rc1"],
    ["git version 2.20.0", "2.20.0"],
  ])("gives ok for %s", async (output, found) => {
    const result = await runWithFakeGit(output);
    expect(result).toEqual({ status: "ok", detail: `git ${found} (minimum 2.20)` });
  });

  it("gives error for a version older than 2.20", async () => {
    const result = await runWithFakeGit("git version 2.19.6");
    expect(result.status).toBe("error");
    expect(result.detail).toBe("git 2.19.6 is older than the minimum 2.20.");
    expect(result.remediation).toBe("Install git 2.20 or newer.");
  });

  it("gives error for output that is not a version", async () => {
    const result = await runWithFakeGit("nonsense");
    expect(result.status).toBe("error");
    expect(result.detail).toBe("cannot read the git version from: nonsense");
  });

  it("gives ok for the real git", async () => {
    const result = await gitVersionCheck().run(env);
    expect(result.status).toBe("ok");
    expect(result.detail).toMatch(/^git \d+\.\d+/);
  });

  it("gives error when git is not installed", async () => {
    const emptyBin = join(dir, "empty-bin");
    mkdirSync(emptyBin);
    const result = await gitVersionCheck().run({ ...env, PATH: emptyBin });
    expect(result.status).toBe("error");
    expect(result.detail).toBe("git is not installed. tasker needs git 2.20 or newer.");
    expect(result.remediation).toBe("Install git 2.20 or newer.");
  });

  it("gives the timeout result when git does not finish", async () => {
    const binDir = join(dir, "bin");
    writeFakeGit(binDir, "exec sleep 5");
    const started = Date.now();
    const result = await gitVersionCheck(200).run({ ...env, PATH: `${binDir}:${env.PATH}` });
    expect(result).toEqual({ status: "error", detail: "the check did not finish in 200 ms" });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
