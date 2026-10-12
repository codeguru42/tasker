import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { filesThatStart, isInside, loadsChildProcess, sourceDir, sourceFiles } from "../../helpers.js";

const moduleSpecifierPattern = /\b(?:from|import|require)\s*\(?\s*(["'`])([^"'`]+)\1/g;

// True when the text of file (a path under src/, with "/") loads or re-exports a module in src/vcs/git/.
// The test cannot find a module name that the code builds at run time.
function importsVcsGit(file: string, text: string): boolean {
  const fileDir = join(sourceDir, dirname(file));
  const gitDir = join(sourceDir, "vcs", "git");
  return [...text.matchAll(moduleSpecifierPattern)].some((match) => {
    const specifier = match[2];
    return specifier.startsWith(".") && isInside(resolve(fileDir, specifier), gitDir);
  });
}

// True when file is outside src/vcs/ and importsVcsGit() is true.
function breaksProviderBoundary(file: string, text: string): boolean {
  return !file.startsWith("vcs/") && importsVcsGit(file, text);
}

describe("the git boundary", () => {
  it("finds the runner in src/vcs/git", () => {
    const inside = filesThatStart("git").filter((file) => file.startsWith("vcs/git/"));
    expect(inside.length).toBeGreaterThan(0);
  });

  it("finds no file outside src/vcs/git that starts git", () => {
    const outside = filesThatStart("git").filter((file) => !file.startsWith("vcs/git/"));
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
