import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  breaksBoundary,
  filesThatBreakBoundary,
  filesThatStart,
  importsPath,
  loadsChildProcess,
  sourceDir,
  startsCommand,
} from "../../helpers/source-scan.js";

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

describe("startsCommand", () => {
  const runChildImport = 'import { runChild } from "../process/run-child.js";';

  it.each([
    ["commands/x.ts", `${runChildImport}\nrunChild("git", ["status"], options);`, "git"],
    ["commands/x.ts", `${runChildImport}\nrunChild("gh status", [], options);`, "gh"],
    ["commands/x.ts", 'export { runChild } from "../process/run-child.js";\nconst c = "git";', "git"],
    ["commands/x.ts", 'const m = await import("../process/run-child.js");\nconst c = "git";', "git"],
    ["commands/x.ts", 'const m = require("../process/run-child.js");\nconst c = "git";', "git"],
    ["main.ts", 'import "./process/run-child.js";\nconst c = "git";', "git"],
    ["commands/x.ts", 'import { spawn } from "node:child_process";\nspawn("git log");', "git"],
  ])("finds %s with %s", (file, text, command) => {
    expect(startsCommand(file, text, command)).toBe(true);
  });

  it.each([
    ["commands/x.ts", 'import { runChild } from "../process/run-child-other.js";\nconst c = "git";', "git"],
    ["commands/x.ts", `${runChildImport}\nrunChild(tool, [], options);`, "git"],
    ["commands/x.ts", `${runChildImport}\nconst c = "github";`, "gh"],
  ])("ignores %s with %s", (file, text, command) => {
    expect(startsCommand(file, text, command)).toBe(false);
  });
});

describe("the provider boundary", () => {
  it("finds no file outside src/vcs that imports from src/vcs/git", () => {
    expect(filesThatBreakBoundary("vcs/", "vcs/git")).toEqual([]);
  });
});

describe("breaksBoundary", () => {
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
    expect(breaksBoundary(file, sample, "vcs/", "vcs/git")).toBe(true);
  });

  it.each([
    ["commands/x.ts", 'import { createVcsProvider } from "../vcs/provider.js";'],
    ["commands/x.ts", 'import { ReconcileConflictError } from "../vcs/errors.js";'],
    ["commands/x.ts", 'import { x } from "./git/run.js";'],
    ["commands/x.ts", 'import { x } from "../vcs/gitlab/run.js";'],
    ["commands/x.ts", 'import { z } from "zod";'],
    ["vcs/provider.ts", 'import { createGitProvider } from "./git/provider.js";'],
  ])("ignores %s with %s", (file, sample) => {
    expect(breaksBoundary(file, sample, "vcs/", "vcs/git")).toBe(false);
  });

  it("skips a file in src/vcs by its path, not by its pattern", () => {
    const sample = 'import { createGitProvider } from "./git/provider.js";';
    expect(importsPath("vcs/provider.ts", sample, join(sourceDir, "vcs", "git"))).toBe(true);
  });
});
