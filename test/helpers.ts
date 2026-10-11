import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// The repo root, for spawn tests that need it as cwd.
export const repoRoot = new URL("..", import.meta.url);
