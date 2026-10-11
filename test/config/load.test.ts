import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { ConfigError } from "../../src/config/schema.js";
import { validConfig } from "../helpers.js";

const home = "/home/me";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tasker-config-"));
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
    try {
      loadConfig({ TASKER_CONFIG: path }, home);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues).toContain("bogus: unrecognized key");
      return;
    }
    throw new Error("expected loadConfig to throw");
  });
});
