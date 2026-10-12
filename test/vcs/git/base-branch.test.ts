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
  fakeSsh,
  type GitOrigin,
  makeGitOrigin,
  makeTempDir,
  readArgLog,
  sshKeyArgs,
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

describe("resolveBaseBranch", () => {
  let origin: GitOrigin;
  let tmp: string;
  let clone: string;
  let env: NodeJS.ProcessEnv;
  let store: TaskStore;
  let askCalls: number;
  let answer: string;

  const SOURCES = ["hinted", "explicit", "learned", "configured", "asked"];

  interface Setup {
    branches: readonly string[];
    remote?: (origin: GitOrigin) => string;
    makeEnv?: (origin: GitOrigin) => NodeJS.ProcessEnv;
  }

  // Makes the origin with the given branches, then the bare clone and the store.
  async function start(setup: Setup): Promise<void> {
    origin = await makeGitOrigin();
    for (const name of setup.branches) {
      await origin.createBranch(name);
    }
    env = setup.makeEnv?.(origin) ?? origin.env;
    tmp = makeTempDir("tasker-base-");
    clone = join(tmp, "repo.git");
    await provisionClone({
      remote: setup.remote?.(origin) ?? origin.path,
      clone,
      config: {},
      env,
      publishTokens: join(tmp, "publish-tokens"),
    });
    store = openStore(join(tmp, "tasker.db"));
    askCalls = 0;
    answer = "asked";
  }

  function resolve(extra: Partial<Parameters<typeof resolveBaseBranch>[0]> = {}) {
    return resolveBaseBranch({
      repoKey: "tasker",
      clone,
      sshKey: undefined,
      env,
      memory: store,
      ask: async () => {
        askCalls += 1;
        return answer;
      },
      ...extra,
    });
  }

  function breakOrigin(): void {
    renameSync(origin.path, `${origin.path}.moved`);
  }

  async function revParse(ref: string): Promise<string> {
    return (await runGit(["rev-parse", ref], { gitDir: clone, env })).trim();
  }

  afterEach(() => {
    store.close();
    origin.remove();
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("fetch", () => {
    describe("with a local origin", () => {
      beforeEach(() => start({ branches: ["gone"] }));

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
        start({
          branches: ["gone"],
          remote: (o) => `ssh://tasker.invalid${o.path}`,
          makeEnv: (o) => fakeSsh(o.dir, o.env, "serve").env,
        }),
      );

      it("fetches with the ssh key of the repo", async () => {
        const logPath = join(origin.dir, "ssh.log");
        rmSync(logPath, { force: true });
        const key = join(origin.dir, "id key");
        await resolve({ sshKey: key, explicit: "main" });
        const calls = readArgLog(logPath);
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
          expect(call.slice(0, 6)).toEqual(sshKeyArgs(key));
        }
      });
    });
  });

  describe("order", () => {
    // A remote branch named origin/main makes the short name origin/main ambiguous in the clone.
    beforeEach(() => start({ branches: [...SOURCES, "origin/main"] }));

    const all = { hint: "hinted", explicit: "explicit", defaultBaseBranch: "configured" };

    it("uses the hint first", async () => {
      store.setDefaultBaseBranch("tasker", "learned");
      const result = await resolve(all);
      expect(result.source).toBe("hint");
      expect(result.base).toBe("hinted");
      expect(askCalls).toBe(0);
    });

    it("uses the explicit base without a hint", async () => {
      store.setDefaultBaseBranch("tasker", "learned");
      const result = await resolve({ explicit: "explicit", defaultBaseBranch: "configured" });
      expect(result.source).toBe("explicit");
      expect(result.base).toBe("explicit");
      expect(askCalls).toBe(0);
    });

    it("uses the learned default without a hint and an explicit base", async () => {
      store.setDefaultBaseBranch("tasker", "learned");
      const result = await resolve({ defaultBaseBranch: "configured" });
      expect(result.source).toBe("learned");
      expect(result.base).toBe("learned");
      expect(askCalls).toBe(0);
    });

    it("uses the configuration when nothing is learned", async () => {
      const result = await resolve({ defaultBaseBranch: "configured" });
      expect(result.source).toBe("config");
      expect(result.base).toBe("configured");
      expect(askCalls).toBe(0);
    });

    it("asks once when nothing else gives a base", async () => {
      const result = await resolve();
      expect(result.source).toBe("ask");
      expect(result.base).toBe("asked");
      expect(askCalls).toBe(1);
    });

    it("uses a hint as it is and does not strip origin/", async () => {
      await expect(resolve({ hint: "origin/hinted" })).rejects.toThrow(
        "the base branch does not exist on origin: origin/hinted (from the issue)",
      );
    });

    it("refuses a hint in the form refs/heads/<x> before the fetch", async () => {
      breakOrigin();
      await expect(resolve({ hint: "refs/heads/main" })).rejects.toThrow(
        "the base branch of the issue must name a remote branch: refs/heads/main",
      );
    });

    it("refuses an empty hint before the fetch", async () => {
      breakOrigin();
      await expect(resolve({ hint: "" })).rejects.toThrow("the base branch of the issue is empty");
    });

    it.each(["a..b", "-x", "main~1", "main^{commit}", "../../heads/main"])(
      "rejects the odd hint %j and stores nothing",
      async (hint) => {
        await expect(resolve({ hint, defaultBaseBranch: "configured" })).rejects.toThrow(hint);
        expect(store.getDefaultBaseBranch("tasker")).toBeUndefined();
      },
    );

    it.each(["-x", "a..b"])("rejects the odd explicit base %j", async (explicit) => {
      await expect(resolve({ explicit })).rejects.toThrow(explicit);
    });

    it("gives a local branch for an explicit refs/heads/<x>", async () => {
      await runGit(["update-ref", "refs/heads/task-1", "refs/remotes/origin/main"], {
        gitDir: clone,
        env: origin.env,
      });
      const result = await resolve({ explicit: "refs/heads/task-1" });
      expect(result.base).toBe("refs/heads/task-1");
      expect(result.revision).toBe("refs/heads/task-1");
    });

    it("strips origin/ from an explicit base", async () => {
      const result = await resolve({ explicit: "origin/explicit" });
      expect(result.base).toBe("explicit");
    });

    it("rejects an answer of ask that does not exist and stores nothing", async () => {
      answer = "nope";
      await expect(resolve()).rejects.toThrow(
        "the base branch does not exist on origin: nope (from the answer)",
      );
      expect(store.getDefaultBaseBranch("tasker")).toBeUndefined();
    });

    it("rejects an answer of ask in the form refs/heads/<x>", async () => {
      answer = "refs/heads/main";
      await expect(resolve()).rejects.toThrow(
        "the base branch must name a remote branch: refs/heads/main",
      );
    });

    it("fails when defaultBaseBranch does not exist, without ask", async () => {
      await expect(resolve({ defaultBaseBranch: "nope" })).rejects.toThrow(
        "the base branch does not exist on origin: nope (from defaultBaseBranch)",
      );
      expect(askCalls).toBe(0);
      expect(store.getDefaultBaseBranch("tasker")).toBeUndefined();
    });

    it("gives the fetched commit and not the stale local copy", async () => {
      await origin.addCommit("main");
      const result = await resolve({ defaultBaseBranch: "main" });
      expect(result.revision).toBe("refs/remotes/origin/main");
      const head = await revParse(result.revision);
      expect(head).toBe(await origin.branchHead("main"));
      expect(head).not.toBe(await revParse("refs/heads/main"));
    });

    it("gives the remote main when the remote has a branch named origin/main", async () => {
      await origin.addCommit("main");
      const result = await resolve({ explicit: "main" });
      expect(result.revision).toBe("refs/remotes/origin/main");
      expect(await revParse(result.revision)).toBe(await origin.branchHead("main"));
    });
  });

  describe("learned default", () => {
    beforeEach(() => start({ branches: SOURCES }));

    const saved = (branch: string) => `tasker saved ${branch} as the default base branch of tasker.`;

    it("saves the value of defaultBaseBranch", async () => {
      const result = await resolve({ defaultBaseBranch: "configured" });
      expect(result.source).toBe("config");
      expect(store.getDefaultBaseBranch("tasker")).toBe("configured");
      expect(result.notes).toEqual([saved("configured")]);
    });

    it("saves the answer of ask", async () => {
      answer = "origin/asked";
      const result = await resolve();
      expect(result.source).toBe("ask");
      expect(store.getDefaultBaseBranch("tasker")).toBe("asked");
      expect(result.notes).toEqual([saved("asked")]);
    });

    it("saves nothing for a hint or an explicit base", async () => {
      await resolve({ hint: "hinted" });
      await resolve({ explicit: "explicit" });
      expect(store.getDefaultBaseBranch("tasker")).toBeUndefined();
    });

    it("does not ask a second time after an answer", async () => {
      await resolve();
      const result = await resolve();
      expect(result.source).toBe("learned");
      expect(result.base).toBe("asked");
      expect(result.notes).toEqual([]);
      expect(askCalls).toBe(1);
    });

    describe("when the learned value is gone from origin", () => {
      beforeEach(async () => {
        store.setDefaultBaseBranch("tasker", "learned");
        await runGit(["branch", "-D", "learned"], { gitDir: origin.path, env: origin.env });
      });

      it("forgets it and asks instead of using defaultBaseBranch", async () => {
        const result = await resolve({ defaultBaseBranch: "configured" });
        expect(askCalls).toBe(1);
        expect(result.source).toBe("ask");
        expect(result.base).toBe("asked");
        expect(store.getDefaultBaseBranch("tasker")).toBe("asked");
        expect(result.notes).toEqual([
          "the learned base branch learned no longer exists on origin. tasker forgot it.",
          saved("asked"),
        ]);
      });

      it("keeps it forgotten when the answer does not exist", async () => {
        answer = "nope";
        await expect(resolve()).rejects.toThrow();
        expect(store.getDefaultBaseBranch("tasker")).toBeUndefined();
      });
    });
  });
});
