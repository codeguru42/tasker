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

// The fixed author and committer of every commit that a git test makes.
export const GIT_TEST_IDENTITY = { name: "Tasker Test", email: "tasker-test@example.com" };

// The env for a git child process. home is a temp folder that stands in for $HOME.
// It reads no git configuration of the host and never asks the terminal.
export function gitTestEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: GIT_TEST_IDENTITY.name,
    GIT_COMMITTER_NAME: GIT_TEST_IDENTITY.name,
    GIT_AUTHOR_EMAIL: GIT_TEST_IDENTITY.email,
    GIT_COMMITTER_EMAIL: GIT_TEST_IDENTITY.email,
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
  };
}
