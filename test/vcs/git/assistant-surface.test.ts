import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DENY_RULES,
  EXECUTE_COMMIT_TEXT,
  readDenyPaths,
  sandboxWritePaths,
} from "../../../src/vcs/git/assistant-surface.js";
import { runGit } from "../../../src/vcs/git/run.js";
import { createTaskWorktree } from "../../../src/vcs/git/worktree.js";
import {
  commitInWorktree,
  failureOf,
  gitCloneTokens,
  isInside,
  makeGitClone,
  makeGitOrigin,
  makeTempDir,
  taskNames,
  type GitOrigin,
} from "../../helpers.js";

const EXPECTED = [
  "Commit each red/green pair, or each completed todo, as its own commit. Never collect the whole plan into one commit at the end. If a run stops partway (a quota limit, a timeout), the work that it finished must stay committed.",
  "The branch can already hold commits from an earlier execute run of an earlier revision of this plan. Before you start, run `git log --reverse {{BASE_REF}}..HEAD` and read what is there. Build on that work. Do not do it again.",
].join("\n\n");

// The bwrap arguments: / read-only, each path of writable open for writes.
function bwrapArgs(
  writable: readonly string[],
  cwd: string,
  command: readonly string[],
): string[] {
  return [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    ...writable.flatMap((path) => ["--bind", path, path]),
    "--chdir",
    cwd,
    "--",
    ...command,
  ];
}

// Runs command in bwrap with the env of the fixture.
function inSandbox(
  writable: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  command: readonly string[],
) {
  const result = spawnSync("bwrap", bwrapArgs(writable, cwd, command), { env, encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  return result;
}

// True when bwrap runs on this host.
const bwrapWorks = (() => {
  const result = spawnSync("bwrap", bwrapArgs([], "/", ["true"]), { stdio: "ignore" });
  return result.error === undefined && result.status === 0;
})();

// Each regular file under folder, mapped to "<ino>:<size>:<mtimeMs>".
function snapshot(folder: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const stat = statSync(file);
    files.set(file, `${stat.ino}:${stat.size}:${stat.mtimeMs}`);
  }
  return files;
}

describe("assistant surface values", () => {
  it("gives the commit rules of the execute prompt", () => {
    expect(EXECUTE_COMMIT_TEXT).toBe(EXPECTED);
  });

  it("denies git push in the shell of the assistant", () => {
    expect(DENY_RULES).toEqual(["Bash(git push:*)"]);
  });

  it.each(["~alice/.ssh/id", "~", "keys/id_tasker", "./id_tasker"])("throws for the ssh key %s", (key) => {
    expect(() => readDenyPaths({ sshKey: key })).toThrow(
      `cannot resolve the ssh key path for the sandbox: ${key}`,
    );
  });

  it("gives no path when no ssh key is set", () => {
    expect(readDenyPaths({})).toEqual([]);
  });

  describe("readDenyPaths with key files", () => {
    let dir: string;

    beforeEach(() => {
      // The real path, so the expected paths hold also when the temp folder is under a symlink.
      dir = realpathSync(makeTempDir("tasker-key-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("gives one path for a key file with no symlink", () => {
      const key = join(dir, "id_tasker");
      writeFileSync(key, "key");
      expect(readDenyPaths({ sshKey: key })).toEqual([key]);
    });

    it("gives the link and the real file for a symlinked key file", () => {
      const realFile = join(dir, "real_id");
      const link = join(dir, "id_tasker");
      writeFileSync(realFile, "key");
      symlinkSync(realFile, link);
      expect(readDenyPaths({ sshKey: link })).toEqual([link, realpathSync(realFile)]);
    });

    it("gives the path and the real path for a key under a symlinked folder", () => {
      const realFolder = join(dir, "dotfiles", "ssh");
      mkdirSync(realFolder, { recursive: true });
      writeFileSync(join(realFolder, "id_tasker"), "key");
      symlinkSync(realFolder, join(dir, "ssh"));
      expect(readDenyPaths({ sshKey: join(dir, "ssh", "id_tasker") })).toEqual([
        join(dir, "ssh", "id_tasker"),
        realpathSync(join(realFolder, "id_tasker")),
      ]);
    });

    it("expands a ~/ ssh key with the home folder", () => {
      // A folder name that no home folder has, so the test does not depend on the host.
      const folder = `.tasker-test-missing-${randomUUID()}`;
      expect(readDenyPaths({ sshKey: `~/${folder}/id_tasker` })).toEqual([
        `${userInfo().homedir}/${folder}/id_tasker`,
      ]);
    });

    it("gives the path alone for a missing key file", () => {
      const key = join(dir, "missing");
      expect(readDenyPaths({ sshKey: key })).toEqual([key]);
    });
  });
});

const { branch: BRANCH } = taskNames("/w", 18);

describe("sandboxWritePaths", () => {
  let origin: GitOrigin;
  let clone: string;
  let worktree: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    clone = await makeGitClone(origin);
    env = origin.env;
    worktree = taskNames(join(origin.dir, "worktrees"), 18).worktree;
    await createTaskWorktree({
      clone,
      env,
      path: worktree,
      branch: BRANCH,
      baseRevision: "refs/remotes/origin/main",
    });
  });

  afterEach(() => {
    origin.remove();
  });

  const writePaths = (path = worktree) => sandboxWritePaths({ clone, env, path });
  const adminDir = () =>
    runGit(["rev-parse", "--git-dir"], { cwd: worktree, env }).then((out) =>
      out.replace(/\r?\n$/, ""),
    );

  it("gives objects, refs, logs and the admin dir, in this order", async () => {
    const real = realpathSync(clone);
    expect(await writePaths()).toEqual([
      join(real, "objects"),
      join(real, "refs"),
      join(real, "logs"),
      await adminDir(),
    ]);
  });

  it("creates logs when it is missing", async () => {
    const logs = join(clone, "logs");
    rmSync(logs, { recursive: true, force: true });
    await writePaths();
    expect(statSync(logs).isDirectory()).toBe(true);
  });

  it("does not cover the clone, hooks, config or the publish tokens", async () => {
    const tokens = gitCloneTokens(origin);
    mkdirSync(tokens, { recursive: true });
    const real = realpathSync(clone);
    const paths = await writePaths();
    expect(paths).not.toContain(real);
    for (const protectedPath of [
      join(real, "hooks"),
      join(real, "config"),
      realpathSync(tokens),
    ]) {
      for (const path of paths) {
        expect(isInside(path, protectedPath)).toBe(false);
        expect(isInside(protectedPath, path)).toBe(false);
      }
    }
  });

  it("gives the same paths for a relative worktree path", async () => {
    expect(await writePaths(relative(process.cwd(), worktree))).toEqual(await writePaths());
  });

  it("calls the worktree guard before it creates logs", async () => {
    const logs = join(clone, "logs");
    rmSync(logs, { recursive: true, force: true });
    const folder = join(origin.dir, "not-a-worktree");
    mkdirSync(folder);
    const error = await failureOf(writePaths(folder), Error);
    expect(error.message).toBe(`not a worktree of the clone: ${folder}`);
    expect(existsSync(logs)).toBe(false);
  });

  it.skipIf(!bwrapWorks)("lets a sandboxed commit work and blocks other writes", async () => {
    const real = realpathSync(clone);
    const tokens = gitCloneTokens(origin);
    mkdirSync(tokens, { recursive: true });
    const realWorktree = realpathSync(worktree);
    const writable = [realWorktree, ...(await writePaths())];
    const tip = () =>
      runGit(["rev-parse", `refs/heads/${BRANCH}`], { gitDir: clone, env });
    const before = await tip();
    writeFileSync(join(worktree, "sandboxed.txt"), "sandboxed\n");
    const add = inSandbox(writable, realWorktree, env, ["git", "add", "-A"]);
    expect(add.status).toBe(0);
    const commit = inSandbox(writable, realWorktree, env, [
      "git",
      "commit",
      "-m",
      "sandboxed commit",
    ]);
    expect(commit.status).toBe(0);
    expect(await tip()).not.toBe(before);
    const subject = await runGit(["log", "-1", "--format=%s"], { cwd: worktree, env });
    expect(subject.trim()).toBe("sandboxed commit");
    for (const file of [
      join(real, "config"),
      join(real, "hooks", "blocked"),
      join(real, "packed-refs"),
      join(realpathSync(tokens), "blocked"),
    ]) {
      const existed = existsSync(file);
      const content = existed ? readFileSync(file) : undefined;
      const write = inSandbox(writable, realWorktree, env, [
        "sh",
        "-c",
        'printf x >> "$1"',
        "sh",
        file,
      ]);
      expect(write.status).not.toBe(0);
      expect(existsSync(file)).toBe(existed);
      if (content !== undefined) expect(readFileSync(file)).toEqual(content);
    }
  });

  it("keeps the files of a commit inside the write paths", async () => {
    const paths = await writePaths();
    const before = snapshot(realpathSync(clone));
    await commitInWorktree(worktree, env, { file: "fallback.txt" });
    const after = snapshot(realpathSync(clone));
    const changed = [...after].filter(([file, value]) => before.get(file) !== value).map(([f]) => f);
    expect(changed).not.toEqual([]);
    for (const file of changed) {
      expect(paths.some((path) => isInside(file, path))).toBe(true);
    }
  });
});
