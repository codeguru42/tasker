import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { model } from "../../src/commands/model.js";
import { loadConfig } from "../../src/config/load.js";
import { ConfigError, parseConfig } from "../../src/config/schema.js";
import {
  configIssuesOf,
  dayAt,
  issueKeyErrorMessage,
  runCommand,
  seedTasks,
  threeRepoConfig,
  useConfigFile,
  validConfig,
} from "../helpers.js";

const KEY = "codeguru42/tasker#5";

// The text of raw as a file with the indent and the final line end that tasker model writes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pretty(raw: Record<string, any>): string {
  return `${JSON.stringify(raw, null, 2)}\n`;
}

// Makes sure that the file still holds before and that its folder holds no other file.
function expectNothingChanged({ dir, path }: { dir: string; path: string }, before: string): void {
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(readdirSync(dir)).toEqual(["config.json"]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawWithProject(dataRoot: string): Record<string, any> {
  const raw = validConfig();
  raw.repos.tasker.issueTracker.project = "codeguru42/tasker";
  return { ...raw, dataRoot };
}

// The raw file of the set and refusal tests, with a key that the schema does not list first.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawFile(dataRoot: string): Record<string, any> {
  return { ...rawWithProject(dataRoot), retentionDays: 7 };
}

describe("model", () => {
  describe("report", () => {
    it("prints the model and the effort of each role", async () => {
      const file = useConfigFile((dataRoot) => pretty(rawWithProject(dataRoot)));
      const before = readFileSync(file.path, "utf8");

      const result = await runCommand(model, "model", KEY);

      expect(result).toEqual({
        code: 0,
        out: "plan: opus (effort high)\nexecute: sonnet (effort medium)\nreview: opus (effort high)\n",
        err: "",
      });
      expectNothingChanged(file, before);
    });

    it("prints only the role that --role names", async () => {
      useConfigFile((dataRoot) => pretty(rawWithProject(dataRoot)));

      const result = await runCommand(model, "model", KEY, "--role", "execute");

      expect(result).toEqual({ code: 0, out: "execute: sonnet (effort medium)\n", err: "" });
    });

    it("fails for an issue key of an unknown project", async () => {
      const file = useConfigFile((dataRoot) => pretty(rawWithProject(dataRoot)));
      const unknown = "codeguru42/unknown#5";

      const result = await runCommand(model, "model", unknown);

      expect(result).toEqual({
        code: 1,
        out: "",
        err: `${issueKeyErrorMessage(unknown, file.path)}\n`,
      });
    });

    it("prints the loader errors for an invalid configuration", async () => {
      const file = useConfigFile((dataRoot) => pretty({ ...rawWithProject(dataRoot), bogus: 1 }));
      const before = readFileSync(file.path, "utf8");
      let message = "";
      try {
        loadConfig({ TASKER_CONFIG: file.path });
      } catch (error) {
        message = (error as Error).message;
      }

      const result = await runCommand(model, "model", KEY);

      expect(result).toEqual({ code: 1, out: "", err: `${message}\n` });
      expect(result.err).toContain("  - bogus: unrecognized key");
      expectNothingChanged(file, before);
      expect(existsSync(file.dataRoot)).toBe(false);
    });

    it("fails for a role that does not exist", async () => {
      useConfigFile((dataRoot) => pretty(rawWithProject(dataRoot)));

      const result = await runCommand(model, "model", KEY, "--role", "chef");

      expect(result.code).not.toBe(0);
      expect(result.out).toBe("");
    });
  });

  describe("repo pick", () => {
    const FORK_REPORT = "plan: haiku (effort low)\nexecute: sonnet (effort medium)\nreview: opus (effort high)\n";
    const TASKER_REPORT = "plan: opus (effort high)\nexecute: sonnet (effort medium)\nreview: opus (effort high)\n";

    // The config of two repos with the project of KEY: codeguru42/tasker and fork. Fork has another plan model.
    function useForkConfig(): { path: string; dataRoot: string } {
      return useConfigFile((dataRoot) => {
        const raw = threeRepoConfig();
        raw.repos.fork.assistant = {
          ...raw.repos.fork.assistant,
          models: { ...raw.repos.fork.assistant.models, plan: { model: "haiku", effort: "low" } },
        };
        return JSON.stringify({ ...raw, dataRoot });
      });
    }

    function seedForkTask(dataRoot: string): void {
      seedTasks(dataRoot, [{ issueKey: KEY, repoKey: "fork", state: "workspace_ready", at: dayAt(2) }]);
    }

    it("uses the repo of the active task when the key matches more than one repo", async () => {
      const { dataRoot } = useForkConfig();
      seedForkTask(dataRoot);

      const result = await runCommand(model, "model", KEY);

      expect(result).toEqual({ code: 0, out: FORK_REPORT, err: "" });
    });

    it("fails when the key matches more than one repo and no task is active", async () => {
      const { path } = useForkConfig();

      const result = await runCommand(model, "model", KEY);

      expect(result).toEqual({ code: 1, out: "", err: `${issueKeyErrorMessage(KEY, path)}\n` });
      expect(result.err).toContain("matches more than one repo");
    });

    it("uses the repo that --repo names, also when another repo has the active task", async () => {
      const { dataRoot } = useForkConfig();
      seedForkTask(dataRoot);

      const result = await runCommand(model, "model", KEY, "--repo", "codeguru42/tasker");

      expect(result).toEqual({ code: 0, out: TASKER_REPORT, err: "" });
    });
  });

  describe("set", () => {
    const NOTE =
      "note: the new model and effort apply only to new sessions. A continued session keeps the model and the effort that it started with.\n";

    it("sets the model and the effort of the role and prints the new line and the note", async () => {
      const file = useConfigFile((dataRoot) => pretty(rawFile(dataRoot)));
      const expected = rawFile(file.dataRoot);
      expected.repos.tasker.assistant.models.plan = { model: "claude-opus-5-5", effort: "low" };

      const result = await runCommand(model, "model", KEY, "--role", "plan", "claude-opus-5-5", "--effort", "low");

      expect(result).toEqual({ code: 0, out: "plan: claude-opus-5-5 (effort low)\n", err: NOTE });
      expectNothingChanged(file, pretty(expected));
    });

    it("keeps the model when only the effort is given", async () => {
      const file = useConfigFile((dataRoot) => pretty(rawFile(dataRoot)));
      const expected = rawFile(file.dataRoot);
      expected.repos.tasker.assistant.models.review.effort = "low";

      const result = await runCommand(model, "model", KEY, "--role", "review", "--effort", "low");

      expect(result).toEqual({ code: 0, out: "review: opus (effort low)\n", err: NOTE });
      expectNothingChanged(file, pretty(expected));
    });

    it("keeps a file without a final line end without one", async () => {
      const file = useConfigFile((dataRoot) => pretty(rawFile(dataRoot)).trimEnd());
      const expected = rawFile(file.dataRoot);
      expected.repos.tasker.assistant.models.execute.effort = "high";

      const result = await runCommand(model, "model", KEY, "--role", "execute", "--effort", "high");

      expect(result.code).toBe(0);
      expectNothingChanged(file, pretty(expected).trimEnd());
    });
  });

  describe("refusals", () => {
    it("fails before it reads the file or opens the store when a set names no role", async () => {
      const file = useConfigFile((dataRoot) => pretty(rawFile(dataRoot)));
      const before = readFileSync(file.path, "utf8");

      const result = await runCommand(model, "model", KEY, "opus");

      expect(result).toEqual({ code: 1, out: "", err: "name the role with --role\n" });
      expectNothingChanged(file, before);
      expect(existsSync(file.dataRoot)).toBe(false);
    });

    it("prints the loader errors and changes nothing for a model that the provider refuses", async () => {
      const file = useConfigFile((dataRoot) => pretty(rawFile(dataRoot)));
      const before = readFileSync(file.path, "utf8");
      const badRaw = rawFile(file.dataRoot);
      badRaw.repos.tasker.assistant.models.plan.model = "gpt-5";
      const message = new ConfigError(configIssuesOf(() => parseConfig(badRaw, {}, "/home/test"))).message;

      const result = await runCommand(model, "model", KEY, "--role", "plan", "gpt-5");

      expect(result).toEqual({ code: 1, out: "", err: `${message}\n` });
      expect(result.err).toContain("repos.tasker.assistant.models.plan.model: is not a claude-code model: gpt-5");
      expectNothingChanged(file, before);
    });

    it("fails for an effort that does not exist", async () => {
      const file = useConfigFile((dataRoot) => pretty(rawFile(dataRoot)));
      const before = readFileSync(file.path, "utf8");

      const result = await runCommand(model, "model", KEY, "--role", "plan", "--effort", "extreme");

      expect(result.code).not.toBe(0);
      expect(result.out).toBe("");
      expectNothingChanged(file, before);
    });
  });
});
