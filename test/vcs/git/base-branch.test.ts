import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, type TaskStore } from "../../../src/store/store.js";
import {
  baseRevision,
  parseBaseInput,
  resolveBaseBranch,
} from "../../../src/vcs/git/base-branch.js";
import { provisionClone } from "../../../src/vcs/git/provision.js";
import { runGit } from "../../../src/vcs/git/run.js";
import {
  type GitOrigin,
  makeGitOrigin,
  makeTempDir,
  readArgLog,
  writeFakeSsh,
} from "../../helpers.js";

describe("parseBaseInput", () => {
  it.each([
    ["origin/main", "main"],
    ["refs/remotes/origin/main", "main"],
    ["origin/feature/x", "feature/x"],
    ["refs/heads/task-1", "refs/heads/task-1"],
    ["main", "main"],
    ["-x", "-x"],
    ["a..b", "a..b"],
  ])("parses %j as %j", (input, expected) => {
    expect(parseBaseInput(input)).toBe(expected);
  });

  it.each(["", "origin/", "refs/remotes/origin/", "refs/heads/"])(
    "rejects the empty base %j",
    (input) => {
      expect(() => parseBaseInput(input)).toThrow("the base branch is empty");
    },
  );

  it.each(["origin/refs/heads/x", "refs/remotes/origin/refs/heads/x"])(
    "rejects %j as a local branch behind a remote prefix",
    (input) => {
      expect(() => parseBaseInput(input)).toThrow(
        `the base branch is not a branch name: ${input}`,
      );
    },
  );
});

describe("baseRevision", () => {
  it.each([
    ["main", "refs/remotes/origin/main"],
    ["feature/x", "refs/remotes/origin/feature/x"],
    ["refs/heads/task-1", "refs/heads/task-1"],
  ])("gives the revision of %j as %j", (base, expected) => {
    expect(baseRevision(base)).toBe(expected);
  });
});

describe("resolveBaseBranch fetch", () => {
  let origin: GitOrigin;
  let tmp: string;
  let clone: string;
  let env: NodeJS.ProcessEnv;
  let store: TaskStore;
  let askCalls: number;

  // Makes the origin with the branches that prepare creates, then the bare clone and the store.
  async function start(
    remote: (origin: GitOrigin) => string,
    makeEnv: (origin: GitOrigin) => NodeJS.ProcessEnv,
  ): Promise<void> {
    origin = await makeGitOrigin();
    await origin.createBranch("gone");
    env = makeEnv(origin);
    tmp = makeTempDir("tasker-base-");
    clone = join(tmp, "repo.git");
    await provisionClone({ remote: remote(origin), clone, config: {}, env });
    store = openStore(join(tmp, "tasker.db"));
    askCalls = 0;
  }

  async function ask(): Promise<string> {
    askCalls += 1;
    return "main";
  }

  function resolve(extra: Partial<Parameters<typeof resolveBaseBranch>[0]> = {}) {
    return resolveBaseBranch({
      repoKey: "tasker",
      clone,
      sshKey: undefined,
      env,
      memory: store,
      ask,
      ...extra,
    });
  }

  function breakOrigin(): void {
    renameSync(origin.path, `${origin.path}.moved`);
  }

  afterEach(() => {
    store.close();
    origin.remove();
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("with a local origin", () => {
    beforeEach(() => start((o) => o.path, (o) => o.env));

    it("sees a branch that origin got after the provision", async () => {
      await origin.createBranch("late");
      await expect(resolve({ explicit: "late" })).resolves.toEqual({
        base: "late",
        revision: "refs/remotes/origin/late",
        source: "explicit",
        notes: [],
      });
    });

    it("does not see a branch that origin lost after the provision", async () => {
      await runGit(["branch", "-D", "gone"], { gitDir: origin.path, env: origin.env });
      await expect(resolve({ explicit: "gone" })).rejects.toThrow(
        "the base branch does not exist: gone (from --base)",
      );
    });

    it("passes a fetch failure through and keeps the learned value", async () => {
      store.setDefaultBaseBranch("tasker", "main");
      breakOrigin();
      await expect(resolve()).rejects.toThrow();
      expect(askCalls).toBe(0);
      expect(store.getDefaultBaseBranch("tasker")).toBe("main");
    });

    it("rejects a bad explicit base before any git call", async () => {
      breakOrigin();
      await expect(resolve({ explicit: "origin/refs/heads/x" })).rejects.toThrow(
        "the base branch is not a branch name: origin/refs/heads/x",
      );
    });
  });

  describe("with an ssh origin", () => {
    beforeEach(() =>
      start(
        (o) => `ssh://tasker.invalid${o.path}`,
        (o) => {
          const binDir = join(o.dir, "bin");
          writeFakeSsh(binDir, join(o.dir, "ssh.log"), "serve");
          return { ...o.env, PATH: `${binDir}:${process.env.PATH}` };
        },
      ),
    );

    it("fetches with the ssh key of the repo", async () => {
      const logPath = join(origin.dir, "ssh.log");
      rmSync(logPath, { force: true });
      const key = join(origin.dir, "id key");
      await resolve({ sshKey: key, explicit: "main" });
      const calls = readArgLog(logPath);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.slice(0, 6)).toEqual([
          "-i",
          key,
          "-o",
          "IdentitiesOnly=yes",
          "-o",
          "BatchMode=yes",
        ]);
      }
    });
  });
});
