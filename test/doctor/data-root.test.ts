import { chmodSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { dataRootCheck, freeSpaceCheck } from "../../src/doctor/data-root.js";
import { createDataRoot } from "../../src/store/layout.js";
import { useTempDir } from "../helpers.js";

describe("dataRootCheck", () => {
  it("is required and named data root", () => {
    const check = dataRootCheck("/d");

    expect({ name: check.name, required: check.required }).toEqual({ name: "data root", required: true });
  });

  it("gives ok on a new path and leaves no probe file", async () => {
    const dataRoot = join(useTempDir("tasker-data-root-check-"), "data");

    const result = await dataRootCheck(dataRoot).run({});

    expect(result.status).toBe("ok");
    expect(readdirSync(dataRoot).sort()).toEqual(["artifacts", "clones", "prompts"]);
  });

  it("gives error when the folders cannot be made", async () => {
    const dir = useTempDir("tasker-data-root-check-");
    const file = join(dir, "file");
    writeFileSync(file, "");
    const dataRoot = join(file, "data");

    const result = await dataRootCheck(dataRoot).run({});

    expect(result.status).toBe("error");
    expect(result.detail).toContain("cannot make the folders of the data root");
    expect(result.detail).toContain(dataRoot);
    expect(result.remediation).toBeDefined();
  });

  it.skipIf(process.getuid?.() === 0)("gives error when the data root folder is read-only", async () => {
    const dataRoot = join(useTempDir("tasker-data-root-check-"), "data");
    createDataRoot(dataRoot);
    chmodSync(dataRoot, 0o555);
    onTestFinished(() => chmodSync(dataRoot, 0o755));

    const result = await dataRootCheck(dataRoot).run({});

    expect(result.status).toBe("error");
    expect(result.detail).toContain("cannot write the file");
    expect(result.detail).toContain(dataRoot);
  });
});

describe("freeSpaceCheck", () => {
  it("is not required and named free space", () => {
    const check = freeSpaceCheck("/d", 1);

    expect({ name: check.name, required: check.required }).toEqual({ name: "free space", required: false });
  });

  it("gives ok when the free space is at least the limit", async () => {
    const dataRoot = useTempDir("tasker-free-space-check-");

    const result = await freeSpaceCheck(dataRoot, 1).run({});

    expect(result.status).toBe("ok");
  });

  it("gives warn with the free bytes and the limit when the free space is below the limit", async () => {
    const dataRoot = useTempDir("tasker-free-space-check-");

    const result = await freeSpaceCheck(dataRoot, Number.MAX_SAFE_INTEGER).run({});

    expect(result.status).toBe("warn");
    expect(result.detail).toMatch(/^\d+ bytes free in /);
    expect(result.detail).toContain(`${Number.MAX_SAFE_INTEGER} bytes`);
  });

  it("gives error when the data root does not exist", async () => {
    const dataRoot = join(useTempDir("tasker-free-space-check-"), "missing");

    const result = await freeSpaceCheck(dataRoot, 1).run({});

    expect(result.status).toBe("error");
  });
});
