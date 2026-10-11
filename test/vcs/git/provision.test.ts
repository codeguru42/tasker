import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionClone } from "../../../src/vcs/git/provision.js";
import { runGit } from "../../../src/vcs/git/run.js";
import { type GitOrigin, makeGitOrigin, makeTempDir } from "../../helpers.js";

describe("provisionClone", () => {
  let origin: GitOrigin;
  let tmp: string;
  let clone: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    tmp = makeTempDir("tasker-provision-");
    clone = join(tmp, "data", "clones", "x", "repo.git");
  });

  afterEach(() => {
    origin.remove();
    rmSync(tmp, { recursive: true, force: true });
  });

  function revParse(ref: string): Promise<string> {
    return runGit(["rev-parse", ref], { gitDir: clone, env: origin.env }).then((out) =>
      out.trim(),
    );
  }

  it("rejects when the remote does not answer and creates no folder", async () => {
    const remote = join(tmp, "missing.git");
    await expect(provisionClone({ remote, clone, config: {}, env: origin.env })).rejects.toThrow(
      `the remote does not answer: ${remote}`,
    );
    expect(existsSync(join(tmp, "data"))).toBe(false);
  });

  it("rejects when the remote has no refs and creates no folder", async () => {
    const remote = join(tmp, "empty.git");
    await runGit(["init", "--bare", "--initial-branch=main", remote], {
      cwd: tmp,
      env: origin.env,
    });
    await expect(provisionClone({ remote, clone, config: {}, env: origin.env })).rejects.toThrow(
      `the remote has no refs: ${remote}`,
    );
    expect(existsSync(join(tmp, "data"))).toBe(false);
  });

  it("clones the remote and fetches its branches as origin/*", async () => {
    await origin.createBranch("feature");
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    expect(await revParse("origin/main")).toBe(await origin.branchHead("main"));
    expect(await revParse("origin/feature")).toBe(await origin.branchHead("feature"));
  });

  it("fetches and keeps the clone when it is complete", async () => {
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    writeFileSync(join(clone, "sentinel"), "keep me");
    const head = await origin.addCommit("main");
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    expect(existsSync(join(clone, "sentinel"))).toBe(true);
    expect(await revParse("origin/main")).toBe(head);
  });

  it("clones again when an earlier clone stopped partway", async () => {
    mkdirSync(clone, { recursive: true });
    writeFileSync(join(clone, "junk"), "left by a clone that stopped");
    writeFileSync(`${clone}.incomplete`, "");
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    expect(existsSync(join(clone, "junk"))).toBe(false);
    expect(await revParse("origin/main")).toBe(await origin.branchHead("main"));
    expect(existsSync(`${clone}.incomplete`)).toBe(false);
  });

  it("removes the marker after success", async () => {
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    expect(existsSync(`${clone}.incomplete`)).toBe(false);
  });
});
