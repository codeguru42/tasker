import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTempDir } from "./helpers/temp.js";

const originalTaskerTestWorkers = process.env.TASKER_TEST_WORKERS;

afterEach(() => {
  if (originalTaskerTestWorkers === undefined) {
    delete process.env.TASKER_TEST_WORKERS;
  } else {
    process.env.TASKER_TEST_WORKERS = originalTaskerTestWorkers;
  }
});

async function loadConfig() {
  vi.resetModules();
  return import("../vitest.config.js");
}

describe("Vitest temp folder", () => {
  it.skipIf(!existsSync("/dev/shm"))("uses /dev/shm for temp folders when available", () => {
    const folder = useTempDir("tasker-vitest-");

    expect(tmpdir()).toBe("/dev/shm");
    expect(dirname(folder)).toBe("/dev/shm");
  });
});

describe("Vitest worker limit", () => {
  it.each([
    ["unset", undefined, "25%"],
    ["empty", "", "25%"],
    ["integer", "4", "4"],
    ["percent", "50%", "50%"],
  ])("uses %s worker limit", async (_name, value, expected) => {
    if (value === undefined) {
      delete process.env.TASKER_TEST_WORKERS;
    } else {
      process.env.TASKER_TEST_WORKERS = value;
    }

    const config = await loadConfig();

    expect(config.default.test?.maxWorkers).toBe(expected);
  });

  it.each(["0", "0%", "-1", "1.5", "abc", " "])("rejects %j", async (value) => {
    process.env.TASKER_TEST_WORKERS = value;

    await expect(loadConfig()).rejects.toThrow(`TASKER_TEST_WORKERS=${JSON.stringify(value)}`);
  });
});
