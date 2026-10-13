import { readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { spawnTasker, validConfig, writeTempConfig } from "./helpers.js";

const root = new URL("..", import.meta.url);

const packageVersion: string = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
).version;

describe("src/main.ts", () => {
  it("prints the package version for --version", async () => {
    const result = await spawnTasker(["--version"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${packageVersion}\n`);
  });

  it("exits with a non-zero status for an unknown option", async () => {
    const result = await spawnTasker(["--bogus"]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unknown option");
  });

  it("prints the configuration for show-config", async () => {
    const written = writeTempConfig(validConfig());
    try {
      const result = await spawnTasker(["show-config"], { TASKER_CONFIG: written.path });

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout).repos.tasker.vcs).toEqual({
        provider: "git",
        config: {},
      });
    } finally {
      rmSync(written.dir, { recursive: true, force: true });
    }
  });
});
