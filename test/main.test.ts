import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);

const packageVersion: string = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
).version;

function tasker(...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/main.ts", ...args],
    { cwd: root, encoding: "utf8" },
  );
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
});
