import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "./helpers/temp.js";

describe("Vitest temp folder", () => {
  it.skipIf(!existsSync("/dev/shm"))("uses /dev/shm for temp folders when available", () => {
    const folder = useTempDir("tasker-vitest-");

    expect(tmpdir()).toBe("/dev/shm");
    expect(dirname(folder)).toBe("/dev/shm");
  });
});
