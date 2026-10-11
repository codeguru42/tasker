import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validConfig, writeTempConfig } from "./helpers.js";

const root = new URL("..", import.meta.url);

const packageVersion: string = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
).version;

function taskerWithEnv(env: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/main.ts", ...args],
    { cwd: root, encoding: "utf8", env: { ...process.env, ...env } },
  );
}

function tasker(...args: string[]) {
  return taskerWithEnv({}, ...args);
}

describe("src/main.ts", () => {
  it("prints the package version for --version", () => {
    const result = tasker("--version");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${packageVersion}\n`);
  });

  it("exits with a non-zero status for an unknown option", () => {
    const result = tasker("--bogus");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unknown option");
  });

  it("prints the configuration for show-config", () => {
    const written = writeTempConfig(validConfig());
    try {
      const result = taskerWithEnv(
        { TASKER_CONFIG: written.path },
        "show-config",
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).repos.tasker.vcs).toEqual({
        provider: "git",
        config: {},
      });
    } finally {
      rmSync(written.dir, { recursive: true, force: true });
    }
  });
});
