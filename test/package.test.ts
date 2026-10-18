import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { runChild } from "../src/process/run-child.js";
import { repoRoot } from "./helpers/processes.js";

interface PackResult {
  files: { path: string }[];
}

async function packFileList(): Promise<string[]> {
  const result = await runChild("npm", ["pack", "--dry-run", "--json"], {
    cwd: fileURLToPath(repoRoot),
    env: process.env,
  });
  expect(result.code, result.stderr).toBe(0);
  const packs = JSON.parse(result.stdout) as PackResult[];
  return packs[0].files.map((file) => file.path);
}

describe("npm pack", () => {
  let paths: string[];

  beforeAll(async () => {
    paths = await packFileList();
  }, 120_000);

  it("holds dist/main.js and skills/tasker/SKILL.md", () => {
    expect(paths).toContain("dist/main.js");
    expect(paths).toContain("skills/tasker/SKILL.md");
  });

  it("holds no path under src/ or test/", () => {
    expect(paths.filter((path) => path.startsWith("src/") || path.startsWith("test/"))).toEqual([]);
  });
});
