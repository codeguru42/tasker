import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { model } from "../../src/commands/model.js";
import { loadConfig } from "../../src/config/load.js";
import { issueKeyErrorMessage, runCommand, useConfigFile, validConfig } from "../helpers.js";

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
});
