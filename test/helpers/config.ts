import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { type Config, parseConfig } from "../../src/config/schema.js";
import { IssueKeyError } from "../../src/issue-key/ref.js";
import { resolveIssueKey } from "../../src/issue-key/resolve.js";
import { makeTempDir, useProcessEnv } from "./temp.js";

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

// Writes the value that build gives for a new temp dir as JSON to config.json in that dir.
// The caller removes dir.
function writeConfigFile(build: (dir: string) => unknown): { dir: string; path: string } {
  const dir = makeTempDir("tasker-config-");
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(build(dir)));
  return { dir, path };
}

// Writes raw as JSON to config.json in a new temp dir. The caller removes dir.
export function writeTempConfig(raw: unknown): { dir: string; path: string } {
  return writeConfigFile(() => raw);
}

// The repo fields of a repo whose plan and review roles get different models (plan sonnet, review opus), so a test can
// tell from the model of a run which role ran. A new object for each call, so a test can change it freely.
export function splitRoleModelsRepo() {
  return {
    assistant: {
      provider: "claude-code",
      models: {
        plan: { model: "sonnet", effort: "low" },
        execute: { model: "sonnet", effort: "medium" },
        review: { model: "opus", effort: "high" },
      },
    },
  };
}

// Writes raw as config.json in a new temp dir, with dataRoot set to <dir>/data. The caller removes dir.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writeDataRootConfig(raw: Record<string, any> = validConfig()): {
  dir: string;
  path: string;
  dataRoot: string;
} {
  const written = writeConfigFile((dir) => ({ ...raw, dataRoot: join(dir, "data") }));
  return { ...written, dataRoot: join(written.dir, "data") };
}

// The repos codeguru42/tasker and codeguru42/other, and the repo fork. The project of fork
// is the same as the project of codeguru42/tasker, so one issue key matches two repos.
export function threeRepoConfig() {
  const raw = validConfig();
  const base = raw.repos.tasker;
  raw.repos["codeguru42/tasker"] = base;
  raw.repos["codeguru42/other"] = { ...base, remote: "git@github.com:codeguru42/other.git" };
  raw.repos.fork = {
    ...base,
    remote: "git@github.com:someone/tasker.git",
    issueTracker: { ...base.issueTracker, project: "codeguru42/tasker" },
  };
  delete raw.repos.tasker;
  return raw;
}

// Writes the text that build gives as config.json in a new temp dir, and points TASKER_CONFIG at it.
// build gets the data root <dir>/data. Call it inside a test. After the test, it restores the env and removes the folder.
export function useConfigFile(build: (dataRoot: string) => string): {
  dir: string;
  path: string;
  dataRoot: string;
} {
  const dir = makeTempDir("tasker-config-");
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const path = join(dir, "config.json");
  const dataRoot = join(dir, "data");
  writeFileSync(path, build(dataRoot));
  useProcessEnv({ TASKER_CONFIG: path });
  return { dir, path, dataRoot };
}

// Writes threeRepoConfig() with useConfigFile(). Call it inside a test.
export function useThreeRepoDataRoot(): { dir: string; path: string; dataRoot: string } {
  return useConfigFile((dataRoot) => JSON.stringify({ ...threeRepoConfig(), dataRoot }));
}

// The issueTracker keys of each repo, by repo key.
export type Trackers = Record<string, Record<string, unknown>>;

// A parsed configuration with one repo for each entry of trackers. Each repo copies the
// repo of validConfig(). Its issueTracker is the issueTracker of validConfig() (which has
// the account that a github tracker needs) with the keys of the entry on top. A jira entry
// uses only its own keys, because a jira tracker refuses the account.
export function configWithTrackers(trackers: Trackers): Config {
  const raw = validConfig();
  const base = raw.repos.tasker;
  raw.repos = Object.fromEntries(
    Object.entries(trackers).map(([key, issueTracker]) => [
      key,
      {
        ...base,
        issueTracker: issueTracker.provider === "jira" ? issueTracker : { ...base.issueTracker, ...issueTracker },
      },
    ]),
  );
  return parseConfig(raw, {}, "/home/test");
}

// The message of the IssueKeyError that resolveIssueKey() throws for key with the
// configuration at configPath. It fails the test when the key resolves.
export function issueKeyErrorMessage(key: string, configPath: string): string {
  try {
    resolveIssueKey(key, loadConfig({ TASKER_CONFIG: configPath }));
  } catch (error) {
    if (!(error instanceof IssueKeyError)) throw error;
    return error.message;
  }
  return expect.fail(`the issue key ${key} resolves`);
}
