import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Io, RegisterCommand } from "../src/cli.js";

export interface CapturedIo extends Io {
  out: string[];
  err: string[];
}

export function captureIo(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
}

export const greet: RegisterCommand = (program) => {
  program
    .command("greet")
    .description("Say hello")
    .option("--name <name>", "Who to greet");
};

// A new object for each call, so a test can change it freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function validConfig(): Record<string, any> {
  return {
    dataRoot: "/data/tasker",
    limits: { bootstrapTimeoutMin: 10, verifyTimeoutMin: 20 },
    repos: {
      tasker: {
        remote: "git@github.com:codeguru42/tasker.git",
        issueTracker: { provider: "github", account: "codeguru42" },
        assistant: {
          provider: "claude-code",
          models: {
            plan: { model: "opus", effort: "high" },
            execute: { model: "sonnet", effort: "medium" },
            review: { model: "opus", effort: "high" },
          },
        },
        verify: { commands: ["npm run check"] },
      },
    },
  };
}

// A new empty folder under the system temp folder. The caller removes it.
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// The names of the tables in db, in alphabetical order.
export function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

// The repo root, for spawn tests that need it as cwd.
export const repoRoot = new URL("..", import.meta.url);

// Writes raw as JSON to config.json in a new temp dir. The caller removes dir.
export function writeTempConfig(raw: unknown): { dir: string; path: string } {
  const dir = makeTempDir("tasker-config-");
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(raw));
  return { dir, path };
}
