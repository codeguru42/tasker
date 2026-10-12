import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitError, GitNotInstalledError, runGit } from "../../../src/vcs/git/run.js";
import { failureOf, gitTestEnv, makeTempDir, repoRoot, writeFakeGit } from "../../helpers.js";

describe("runGit", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = makeTempDir("tasker-run-git-");
    env = gitTestEnv(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs in cwd and resolves with stdout", async () => {
    const out = await runGit(["init", "--initial-branch=main"], { cwd: dir, env });
    expect(out).toContain("Initialized empty Git repository");
  });

  it("uses the repo of the cwd, not a GIT_DIR of the caller", async () => {
    await runGit(["init", "--initial-branch=main", "mine"], { cwd: dir, env });
    await runGit(["init", "--initial-branch=main", "other"], { cwd: dir, env });
    const out = await runGit(["rev-parse", "--absolute-git-dir"], {
      cwd: join(dir, "mine"),
      env: { ...env, GIT_DIR: join(dir, "other", ".git") },
    });
    expect(out).toBe(`${realpathSync(join(dir, "mine", ".git"))}\n`);
  });

  it("runs against a bare clone and does not trim stdout", async () => {
    await runGit(["init", "--bare", "--initial-branch=main", "bare.git"], { cwd: dir, env });
    const out = await runGit(["symbolic-ref", "HEAD"], {
      gitDir: join(dir, "bare.git"),
      env,
    });
    expect(out).toBe("refs/heads/main\n");
  });

  it("rejects with a GitError that names the subcommand and holds the output", async () => {
    await runGit(["init", "--bare", "--initial-branch=main", "bare.git"], { cwd: dir, env });
    const gitError = await failureOf(
      runGit(["rev-parse", "--verify", "no-such-ref"], { gitDir: join(dir, "bare.git"), env }),
      GitError,
    );
    expect(gitError).toBeInstanceOf(GitError);
    expect(gitError.message).toContain("git rev-parse failed with exit code");
    expect(gitError.message).toContain("Needed a single revision");
    expect(gitError.subcommand).toBe("rev-parse");
    expect(gitError.stderr).toContain("Needed a single revision");
    expect(gitError.stdout).toBe("");
  });

  it("rejects a git dir that does not exist", async () => {
    const missing = join(dir, "missing.git");
    const error = await failureOf(runGit(["rev-parse", "HEAD"], { gitDir: missing, env }), Error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GitError);
    expect(error.message).toBe(`the git dir does not exist: ${missing}`);
  });

  function makeOtherFolder(): string {
    const other = join(dir, "other");
    mkdirSync(other);
    writeFileSync(join(other, "b.txt"), "b\n");
    return other;
  }

  it("ignores a GIT_WORK_TREE of the caller for a bare git dir", async () => {
    await runGit(["init", "--bare", "--initial-branch=main", "bare.git"], { cwd: dir, env });
    const other = makeOtherFolder();
    const error = await failureOf(
      runGit(["add", "-A"], {
        gitDir: join(dir, "bare.git"),
        env: { ...env, GIT_WORK_TREE: other },
      }),
      GitError,
    );
    expect(error).toBeInstanceOf(GitError);
    expect(error.message).toContain("must be run in a work tree");
    expect(existsSync(join(dir, "bare.git", "index"))).toBe(false);
  });

  it("keeps a bare git dir bare", async () => {
    await runGit(["init", "--bare", "--initial-branch=main", "bare.git"], { cwd: dir, env });
    const out = await runGit(["rev-parse", "--is-bare-repository"], {
      gitDir: join(dir, "bare.git"),
      env,
    });
    expect(out).toBe("true\n");
  });

  it("rejects a git dir that is a file", async () => {
    const file = join(dir, "file");
    writeFileSync(file, "x\n");
    const error = await failureOf(runGit(["rev-parse", "HEAD"], { gitDir: file, env }), Error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GitError);
    expect(error.message).toBe(`the git dir does not exist: ${file}`);
  });

  it("rejects a working folder that is a file", async () => {
    const file = join(dir, "file");
    writeFileSync(file, "x\n");
    const error = await failureOf(runGit(["status"], { cwd: file, env }), Error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GitError);
    expect(error.message).toBe(`the working folder does not exist: ${file}`);
  });

  it("rejects with an AbortError when the signal fires", async () => {
    const binDir = join(dir, "bin");
    writeFakeGit(binDir, "exec sleep 5");
    const started = Date.now();
    const error = await failureOf(
      runGit(["version"], {
        cwd: dir,
        env: { ...env, PATH: `${binDir}:${env.PATH}` },
        signal: AbortSignal.timeout(100),
      }),
      Error,
    );
    expect(error.name).toBe("AbortError");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("runs as before when the call has no signal", async () => {
    const out = await runGit(["version"], { cwd: dir, env });
    expect(out).toContain("git version");
  });

  it("rejects empty args", async () => {
    await expect(runGit([], { cwd: dir, env })).rejects.toThrow("runGit needs a git subcommand");
  });

  it("rejects args that start with an option", async () => {
    await expect(runGit(["-c", "x.y=z", "status"], { cwd: dir, env })).rejects.toThrow(
      "runGit needs the git subcommand as the first argument",
    );
  });

  it("reports that git is not installed when git is not on PATH", async () => {
    const emptyPath = join(dir, "empty-bin");
    mkdirSync(emptyPath);
    const error = await failureOf(
      runGit(["version"], { cwd: dir, env: { ...env, PATH: emptyPath } }),
      GitNotInstalledError,
    );
    expect(error).toBeInstanceOf(GitNotInstalledError);
    expect(error.message).toBe("git is not installed: git was not found on PATH");
  });

  it("reports that git is not installed when the env has no PATH", async () => {
    const withoutPath = { ...env };
    delete withoutPath.PATH;
    const error = await failureOf(
      runGit(["version"], { cwd: dir, env: withoutPath }),
      GitNotInstalledError,
    );
    expect(error).toBeInstanceOf(GitNotInstalledError);
    expect(error.message).toBe("git is not installed: the env has no PATH");
  });

  it("reports that git is not installed when PATH is empty", async () => {
    const error = await failureOf(
      runGit(["version"], { cwd: dir, env: { ...env, PATH: "" } }),
      GitNotInstalledError,
    );
    expect(error).toBeInstanceOf(GitNotInstalledError);
    expect(error.message).toBe("git is not installed: the env has no PATH");
  });

  it("reports a missing working folder, not a missing git", async () => {
    const missing = join(dir, "no-such-folder");
    const error = await failureOf(runGit(["status"], { cwd: missing, env }), Error);
    expect(error).not.toBeInstanceOf(GitNotInstalledError);
    expect(error.message).toBe(`the working folder does not exist: ${missing}`);
  });

  it("writes nothing to the terminal, also when git fails", async () => {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", "test/fixtures/git-quiet.ts"], {
          cwd: repoRoot,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      },
    );
    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});

describe("runGit keeps git from asking questions", () => {
  let dir: string;
  let bin: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = makeTempDir("tasker-run-git-tty-");
    bin = join(dir, "bin");
    env = { ...gitTestEnv(dir), PATH: bin, GIT_TERMINAL_PROMPT: "1" };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const envScript = [
    'echo "prompt=$GIT_TERMINAL_PROMPT"',
    'if [ "${GIT_SSH_COMMAND+set}" = set ]; then echo "ssh-command=$GIT_SSH_COMMAND"; else echo "ssh-command unset"; fi',
    'if [ "${GIT_SSH+set}" = set ]; then echo "ssh=$GIT_SSH"; else echo "ssh unset"; fi',
  ].join("\n");

  const repoLocalVars = [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
  ];
  const keptVars = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"];

  // Prints the name of each variable of names that git sees. Shell builtins only.
  const seenScript = (names: string[]) =>
    [
      `for name in ${names.join(" ")}; do`,
      '  eval "seen=\\${$name+set}"',
      '  if [ "$seen" = set ]; then echo "$name"; fi',
      "done",
    ].join("\n");

  it.each(["cwd", "gitDir"] as const)(
    "passes no repo-local git variable of the caller to git in %s mode",
    async (mode) => {
      writeFakeGit(bin, seenScript([...repoLocalVars, ...keptVars]));
      const callerEnv: NodeJS.ProcessEnv = { ...env };
      for (const name of repoLocalVars) {
        callerEnv[name] = name === "GIT_CONFIG_COUNT" ? "1" : join(dir, "elsewhere");
      }
      const gitDir = join(dir, "bare.git");
      mkdirSync(gitDir);
      const location = mode === "cwd" ? { cwd: dir } : { gitDir };
      const out = await runGit(["version"], { ...location, env: callerEnv });
      expect(out).toBe("GIT_CONFIG_GLOBAL\nGIT_CONFIG_NOSYSTEM\n");
    },
  );

  const batch = "prompt=0\nssh-command=ssh -o BatchMode=yes\nssh unset\n";
  const ownSsh = "prompt=0\nssh-command unset\nssh=/opt/bin/my-ssh\n";

  it("sets GIT_TERMINAL_PROMPT to 0 and runs ssh in batch mode", async () => {
    writeFakeGit(bin, envScript);
    const out = await runGit(["version"], { cwd: dir, env });
    expect(out).toBe(batch);
  });

  it("keeps the GIT_SSH_COMMAND of the caller", async () => {
    writeFakeGit(bin, envScript);
    const out = await runGit(["version"], {
      cwd: dir,
      env: { ...env, GIT_SSH_COMMAND: "ssh -i /keys/id" },
    });
    expect(out).toBe("prompt=0\nssh-command=ssh -i /keys/id\nssh unset\n");
  });

  it("keeps the GIT_SSH of the caller", async () => {
    writeFakeGit(bin, envScript);
    const out = await runGit(["version"], {
      cwd: dir,
      env: { ...env, GIT_SSH: "/opt/bin/my-ssh" },
    });
    expect(out).toBe(ownSsh);
  });

  it("runs ssh in batch mode when the caller GIT_SSH_COMMAND is empty", async () => {
    writeFakeGit(bin, envScript);
    const out = await runGit(["version"], { cwd: dir, env: { ...env, GIT_SSH_COMMAND: "" } });
    expect(out).toBe(batch);
  });

  it("removes an empty GIT_SSH_COMMAND and keeps the GIT_SSH of the caller", async () => {
    writeFakeGit(bin, envScript);
    const out = await runGit(["version"], {
      cwd: dir,
      env: { ...env, GIT_SSH_COMMAND: "", GIT_SSH: "/opt/bin/my-ssh" },
    });
    expect(out).toBe(ownSsh);
  });

  it("removes an empty GIT_SSH and runs ssh in batch mode", async () => {
    writeFakeGit(bin, envScript);
    const out = await runGit(["version"], { cwd: dir, env: { ...env, GIT_SSH: "" } });
    expect(out).toBe(batch);
  });

  it("runs ssh in batch mode when both ssh variables are empty", async () => {
    writeFakeGit(bin, envScript);
    const out = await runGit(["version"], {
      cwd: dir,
      env: { ...env, GIT_SSH_COMMAND: "", GIT_SSH: "" },
    });
    expect(out).toBe(batch);
  });

  it("starts git one time for a git dir", async () => {
    const log = join(dir, "runs.log");
    const gitDir = join(dir, "bare.git");
    mkdirSync(gitDir);
    writeFakeGit(bin, `echo "$*" >> '${log}'`);
    await runGit(["version"], { gitDir, env });
    expect(readFileSync(log, "utf8")).toBe(`--bare --git-dir ${gitDir} version\n`);
  });

  it.runIf(existsSync("/proc/self/stat"))("keeps git in the process group of tasker", async () => {
    writeFakeGit(
      bin,
      ["read -r pid comm state ppid pgrp rest < /proc/$$/stat", 'echo "$pgrp"'].join("\n"),
    );
    const stat = readFileSync("/proc/self/stat", "utf8");
    const pgrp = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2];
    const out = await runGit(["version"], { cwd: dir, env });
    expect(out).toBe(`${pgrp}\n`);
  });
});
