import { existsSync, rmSync } from "node:fs";
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

  it("clones the remote and fetches its branches as origin/*", async () => {
    await origin.createBranch("feature");
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    expect(await revParse("origin/main")).toBe(await origin.branchHead("main"));
    expect(await revParse("origin/feature")).toBe(await origin.branchHead("feature"));
  });

  it("removes the marker after success", async () => {
    await provisionClone({ remote: origin.path, clone, config: {}, env: origin.env });
    expect(existsSync(`${clone}.incomplete`)).toBe(false);
  });
});
