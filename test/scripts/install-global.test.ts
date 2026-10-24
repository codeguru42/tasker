import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type ChildResult, runChild } from "../../src/process/run-child.js";
import { logLine, pathWithFirst, readArgLog, writeFakeCommand } from "../helpers/fake-commands.js";
import { gitOutput, gitTestEnv } from "../helpers/git.js";
import { repoRoot } from "../helpers/processes.js";
import { useTempDir, useTempHome, writeFileWithParents } from "../helpers/temp.js";

const committedPackageJson = '{"name":"tasker","version":"0.1.0"}\n';

interface InstallRepo {
  repo: string;
  env: NodeJS.ProcessEnv;
  npmLog: string;
  taskerLog: string;
}

// A git repo with one commit and the given tags. A fake npm and a fake tasker come first on PATH.
// The logs and the state file are outside the repo, so they never make the tree dirty.
async function useInstallRepo(options: { tags?: string[] } = {}): Promise<InstallRepo> {
  const dir = useTempDir("tasker-install-");
  const baseEnv = gitTestEnv(useTempHome().HOME);
  const repo = join(dir, "repo");
  const bin = join(dir, "bin");
  const npmLog = join(dir, "npm.log");
  const taskerLog = join(dir, "tasker.log");
  const state = join(dir, "version");
  const env = { ...baseEnv, PATH: pathWithFirst(bin, baseEnv) };

  writeFileWithParents(join(repo, "package.json"), committedPackageJson);
  writeFileWithParents(join(repo, ".gitignore"), "*.tgz\n");
  writeFileWithParents(join(repo, "skills", "a.md"), "a\n");
  await gitOutput({ cwd: repo }, env, "init", "-b", "main");
  await gitOutput({ cwd: repo }, env, "add", "-A");
  await gitOutput({ cwd: repo }, env, "commit", "-m", "init");
  for (const tag of options.tags ?? []) {
    await gitOutput({ cwd: repo }, env, "tag", tag);
  }

  writeFakeCommand(
    bin,
    "npm",
    `${logLine(npmLog)}
case "$1" in
  pkg)
    printf '%s' "\${3#version=}" > '${state}'
    printf '{"changed":true}' > package.json
    ;;
  pack)
    : > "tasker-$(cat '${state}').tgz"
    ;;
  install)
    if [ "$FAIL_INSTALL" = 1 ]; then exit 1; fi
    ;;
esac
exit 0`,
  );
  writeFakeCommand(
    bin,
    "tasker",
    `${logLine(taskerLog)}
if [ "$1" = "--version" ]; then
  if [ -n "$TASKER_VERSION" ]; then printf '%s\\n' "$TASKER_VERSION"; else cat '${state}'; echo; fi
fi
exit 0`,
  );
  return { repo, env, npmLog, taskerLog };
}

function runInstallGlobal(repo: string, env: NodeJS.ProcessEnv): Promise<ChildResult> {
  return runChild(process.execPath, [fileURLToPath(new URL("scripts/install-global.ts", repoRoot))], {
    cwd: repo,
    env,
  });
}

// The expected date, with the UTC getters and no leading zeros.
function utcDate(now: Date): string {
  return `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}`;
}

describe("install:global", () => {
  it("installs a version of the date and the commit when HEAD has no tag", async () => {
    const { repo, env, npmLog } = await useInstallRepo();
    const commit = await gitOutput({ cwd: repo }, env, "rev-parse", "--short", "HEAD");
    const before = utcDate(new Date());
    const result = await runInstallGlobal(repo, env);
    const after = utcDate(new Date());

    expect(result.code).toBe(0);
    const calls = readArgLog(npmLog);
    const version = calls.find((call) => call[0] === "pkg")?.[2]?.replace("version=", "") ?? "missing";
    expect([`${before}-${commit}`, `${after}-${commit}`]).toContain(version);
    expect(calls).toContainEqual(["install", "-g", `./tasker-${version}.tgz`]);
  });

  it("installs the package of the one tag in order", async () => {
    const { repo, env, npmLog, taskerLog } = await useInstallRepo({ tags: ["2026.10.24"] });
    const result = await runInstallGlobal(repo, env);

    expect(result.code).toBe(0);
    expect(readArgLog(npmLog)).toEqual([
      ["ci"],
      ["pkg", "set", "version=2026.10.24"],
      ["pack"],
      ["install", "-g", "./tasker-2026.10.24.tgz"],
    ]);
    expect(readArgLog(taskerLog)).toEqual([["--version"], ["install-skills"]]);
    expect(existsSync(join(repo, "tasker-2026.10.24.tgz"))).toBe(false);
    expect(readFileSync(join(repo, "package.json"), "utf8")).toBe(committedPackageJson);
  });

  it("stops before any install step when HEAD has two tags and names each tag", async () => {
    const { repo, env, npmLog } = await useInstallRepo({ tags: ["2026.10.24", "2026.10.24-c0c0d1a5"] });
    const result = await runInstallGlobal(repo, env);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("2026.10.24");
    expect(result.stderr).toContain("2026.10.24-c0c0d1a5");
    expect(result.stderr).toContain("more than one tag");
    expect(readArgLog(npmLog)).toEqual([]);
  });

  it("stops before any install step when a tracked file has changes", async () => {
    const { repo, env, npmLog } = await useInstallRepo({ tags: ["2026.10.24"] });
    writeFileWithParents(join(repo, "skills", "a.md"), "changed\n");
    const result = await runInstallGlobal(repo, env);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("the working tree has changes");
    expect(readArgLog(npmLog)).toEqual([]);
  });

  it("stops before any install step when the working tree has an untracked file", async () => {
    const { repo, env, npmLog } = await useInstallRepo({ tags: ["2026.10.24"] });
    writeFileWithParents(join(repo, "skills", "b.md"), "b\n");
    const result = await runInstallGlobal(repo, env);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("the working tree has changes");
    expect(readArgLog(npmLog)).toEqual([]);
  });

  it("reports all problems in one run", async () => {
    const { repo, env, npmLog } = await useInstallRepo({ tags: ["2026.10.24", "2026.10.25"] });
    writeFileWithParents(join(repo, "skills", "a.md"), "changed\n");
    const result = await runInstallGlobal(repo, env);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("more than one tag");
    expect(result.stderr).toContain("the working tree has changes");
    expect(readArgLog(npmLog)).toEqual([]);
  });

  it("restores package.json and deletes the package file when a step fails", async () => {
    const { repo, env, npmLog, taskerLog } = await useInstallRepo({ tags: ["2026.10.24"] });
    const result = await runInstallGlobal(repo, { ...env, FAIL_INSTALL: "1" });

    expect(result.code).toBe(1);
    expect(readFileSync(join(repo, "package.json"), "utf8")).toBe(committedPackageJson);
    expect(await gitOutput({ cwd: repo }, env, "status", "--porcelain")).toBe("");
    expect(existsSync(join(repo, "tasker-2026.10.24.tgz"))).toBe(false);
    expect(readArgLog(npmLog).at(-1)).toEqual(["install", "-g", "./tasker-2026.10.24.tgz"]);
    expect(readArgLog(taskerLog)).toEqual([]);
  });

  it("fails when tasker --version does not print the version", async () => {
    const { repo, env, taskerLog } = await useInstallRepo({ tags: ["2026.10.24"] });
    const result = await runInstallGlobal(repo, { ...env, TASKER_VERSION: "2026.10.23" });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("2026.10.23");
    expect(result.stderr).toContain("2026.10.24");
    expect(readArgLog(taskerLog)).toEqual([["--version"]]);
  });
});
