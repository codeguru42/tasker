import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../../../src/", import.meta.url));

const importsChildProcess = /from\s+["'](?:node:)?child_process["']|require\(\s*["'](?:node:)?child_process["']\s*\)/;
const gitLiteral = /(["'`])git(?: [^"'`]*)?\1/;

// The files under src/ (paths with "/") that start git.
// The scan finds a literal "git". It cannot find a name that is built at run time.
function filesThatStartGit(): string[] {
  const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
    .map((file) => file.split("\\").join("/"))
    .filter((file) => file.endsWith(".ts"));
  return files.filter((file) => {
    const text = readFileSync(join(srcDir, file), "utf8");
    return importsChildProcess.test(text) && gitLiteral.test(text);
  });
}

describe("the git boundary", () => {
  it("finds the runner in src/vcs/git", () => {
    const inside = filesThatStartGit().filter((file) => file.startsWith("vcs/git/"));
    expect(inside.length).toBeGreaterThan(0);
  });

  it("finds no file outside src/vcs/git that starts git", () => {
    const outside = filesThatStartGit().filter((file) => !file.startsWith("vcs/git/"));
    expect(outside).toEqual([]);
  });
});
