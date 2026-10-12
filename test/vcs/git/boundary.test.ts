import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../../../src/", import.meta.url));

const childProcessName = String.raw`["'\`](?:node:)?child_process["'\`]`;
const loadsChildProcessPattern = new RegExp(
  [
    String.raw`\bfrom\s*${childProcessName}`, // import ... from, export ... from
    String.raw`\bimport\s*${childProcessName}`, // import "child_process"
    String.raw`\bimport\s*\(\s*${childProcessName}`, // import("child_process")
    String.raw`\brequire\s*\(\s*${childProcessName}`, // require("child_process")
  ].join("|"),
);

// True when text loads the child process module in any of these forms.
function loadsChildProcess(text: string): boolean {
  return loadsChildProcessPattern.test(text);
}

const gitLiteral = /(["'`])git(?: [^"'`]*)?\1/;

// The files under src/ (paths with "/") that start git.
// The scan finds a literal "git" and a literal module name.
// It cannot find a module name or a git name that is built at run time.
function filesThatStartGit(): string[] {
  const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
    .map((file) => file.split("\\").join("/"))
    .filter((file) => file.endsWith(".ts"));
  return files.filter((file) => {
    const text = readFileSync(join(srcDir, file), "utf8");
    return loadsChildProcess(text) && gitLiteral.test(text);
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

describe("loadsChildProcess", () => {
  it.each([
    'import { spawn } from "node:child_process";',
    "import cp from 'child_process';",
    'import "node:child_process";',
    'const cp = await import("node:child_process");',
    "const cp = await import(`child_process`);",
    "const cp = require('child_process');",
    'export { spawn } from "node:child_process";',
    "export * from 'child_process';",
  ])("finds %s", (sample) => {
    expect(loadsChildProcess(sample)).toBe(true);
  });

  it.each([
    'import { x } from "./child_process-utils.js";',
    "// this file does not use child_process",
    'import { readFileSync } from "node:fs";',
    'const name = "child_processes";',
  ])("ignores %s", (sample) => {
    expect(loadsChildProcess(sample)).toBe(false);
  });
});

describe("the provider boundary", () => {
  it("finds no file outside src/vcs that imports from src/vcs/git", () => {
    const broken = sourceFiles().filter(({ file, text }) => breaksProviderBoundary(file, text));
    expect(broken.map(({ file }) => file)).toEqual([]);
  });
});

describe("breaksProviderBoundary", () => {
  it.each([
    ["commands/x.ts", 'import { runGit } from "../vcs/git/run.js";'],
    ["commands/x.ts", 'import type { GitError } from "../vcs/git/run.js";'],
    ["commands/x.ts", 'import "../vcs/git/run.js";'],
    ["commands/x.ts", 'const m = await import("../vcs/git/run.js");'],
    ["commands/x.ts", "const m = await import('../vcs/git/run.js');"],
    ["commands/x.ts", "const m = await import(`../vcs/git/run.js`);"],
    ["commands/x.ts", 'const m = require("../vcs/git/run.js");'],
    ["commands/x.ts", 'export { runGit } from "../vcs/git/run.js";'],
    ["commands/x.ts", 'export * from "../vcs/git/run.js";'],
    ["commands/x.ts", 'export type { GitLocation } from "../vcs/git/run.js";'],
    ["main.ts", 'import "./vcs/git/run.js";'],
  ])("finds %s with %s", (file, sample) => {
    expect(breaksProviderBoundary(file, sample)).toBe(true);
  });

  it.each([
    ["commands/x.ts", 'import { createVcsProvider } from "../vcs/provider.js";'],
    ["commands/x.ts", 'import { ReconcileConflictError } from "../vcs/errors.js";'],
    ["commands/x.ts", 'import { x } from "./git/run.js";'],
    ["commands/x.ts", 'import { x } from "../vcs/gitlab/run.js";'],
    ["commands/x.ts", 'import { z } from "zod";'],
    ["vcs/provider.ts", 'import { createGitProvider } from "./git/provider.js";'],
  ])("ignores %s with %s", (file, sample) => {
    expect(breaksProviderBoundary(file, sample)).toBe(false);
  });

  it("skips a file in src/vcs by its path, not by its pattern", () => {
    const sample = 'import { createGitProvider } from "./git/provider.js";';
    expect(importsVcsGit("vcs/provider.ts", sample)).toBe(true);
  });
});
