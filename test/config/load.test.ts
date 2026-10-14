import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, loadConfigFile, parseConfigText } from "../../src/config/load.js";
import { configIssuesOf, makeTempDir, validConfig } from "../helpers.js";

const home = "/home/me";
let dir: string;

beforeEach(() => {
  dir = makeTempDir("tasker-config-");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("reads the file that TASKER_CONFIG names", () => {
    const path = join(dir, "c.json");
    writeFileSync(path, JSON.stringify(validConfig()));
    expect(loadConfig({ TASKER_CONFIG: path }, home).retentionDays).toBe(30);
  });

  it("reads tasker/config.json under XDG_CONFIG_HOME", () => {
    mkdirSync(join(dir, "tasker"));
    writeFileSync(join(dir, "tasker", "config.json"), JSON.stringify(validConfig()));
    expect(loadConfig({ XDG_CONFIG_HOME: dir }, home).retentionDays).toBe(30);
  });

  it("throws when the file is missing", () => {
    const path = join(dir, "missing.json");
    expect(() => loadConfig({ TASKER_CONFIG: path }, home)).toThrow(
      `config file not found: ${path}`,
    );
  });

  it("names the real error when the path cannot be read", () => {
    try {
      loadConfig({ TASKER_CONFIG: dir }, home);
    } catch (error) {
      expect((error as Error).message).toBe(`cannot read config file: ${dir} (EISDIR)`);
      expect((error as Error).cause).toBeDefined();
      return;
    }
    throw new Error("expected loadConfig to throw");
  });

  it("throws when the file is not valid JSON", () => {
    const path = join(dir, "c.json");
    writeFileSync(path, "{");
    expect(() => loadConfig({ TASKER_CONFIG: path }, home)).toThrow(
      `config file is not valid JSON: ${path}`,
    );
  });

  it("throws a ConfigError for a file that breaks the schema", () => {
    const path = join(dir, "c.json");
    writeFileSync(path, JSON.stringify({ ...validConfig(), bogus: 1 }));
    expect(configIssuesOf(() => loadConfig({ TASKER_CONFIG: path }, home))).toContain("bogus: unrecognized key");
  });
});

describe("loadConfigFile", () => {
  it("gives the path, the exact text and the configuration of the file", () => {
    const path = join(dir, "c.json");
    const text = `${JSON.stringify(validConfig(), null, 4)}\n`;
    writeFileSync(path, text);
    const env = { TASKER_CONFIG: path };

    expect(loadConfigFile(env, home)).toEqual({ path, text, config: loadConfig(env, home) });
  });

  it("throws the same error as loadConfig when the file is missing", () => {
    const path = join(dir, "missing.json");
    expect(() => loadConfigFile({ TASKER_CONFIG: path }, home)).toThrow(
      `config file not found: ${path}`,
    );
  });
});

describe("parseConfigText", () => {
  it("gives the same configuration as loadConfig for the same text", () => {
    const path = join(dir, "c.json");
    const text = JSON.stringify(validConfig());
    writeFileSync(path, text);

    expect(parseConfigText(text, path, {}, home)).toEqual(loadConfig({ TASKER_CONFIG: path }, home));
  });

  it("throws when the text is not valid JSON", () => {
    const path = join(dir, "c.json");
    expect(() => parseConfigText("{", path, {}, home)).toThrow(
      `config file is not valid JSON: ${path}`,
    );
  });

  it("throws a ConfigError for text that breaks the schema", () => {
    const text = JSON.stringify({ ...validConfig(), bogus: 1 });
    expect(configIssuesOf(() => parseConfigText(text, join(dir, "c.json"), {}, home))).toContain(
      "bogus: unrecognized key",
    );
  });
});
