import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { archivePrompt, promptVersion } from "../../src/prompts/archive.js";
import { useTempDir } from "../helpers.js";

function hash12(template: string): string {
  return createHash("sha256").update(template).digest("hex").slice(0, 12);
}

describe("promptVersion", () => {
  it("gives the name and the first 12 hex digits of the sha256 of the template", () => {
    const version = promptVersion("plan", "Template text");

    expect(version).toMatch(/^plan@[0-9a-f]{12}$/);
    expect(version).toBe(`plan@${hash12("Template text")}`);
  });

  it("refuses a name that holds @", () => {
    expect(() => promptVersion("a@b", "x")).toThrow('prompt name must not hold "@": a@b');
  });
});

describe("archivePrompt", () => {
  it("makes the missing prompts folder and the file with the template", () => {
    const dataRoot = join(useTempDir("tasker-archive-"), "root");

    const { version, path } = archivePrompt(dataRoot, "plan", "Template text");

    expect(version).toBe(promptVersion("plan", "Template text"));
    expect(path).toBe(join(dataRoot, "prompts", `${version}.md`));
    expect(readFileSync(path, "utf8")).toBe("Template text");
  });

  it("keeps the file of a version that exists", () => {
    const dataRoot = useTempDir("tasker-archive-");
    const first = archivePrompt(dataRoot, "plan", "Template text");
    writeFileSync(first.path, "Other text");

    const second = archivePrompt(dataRoot, "plan", "Template text");

    expect(second).toEqual(first);
    expect(readFileSync(first.path, "utf8")).toBe("Other text");
  });

  it("writes a new file for a changed template and keeps the old file", () => {
    const dataRoot = useTempDir("tasker-archive-");
    const first = archivePrompt(dataRoot, "plan", "Template text");

    const second = archivePrompt(dataRoot, "plan", "Changed text");

    expect(second.version).not.toBe(first.version);
    expect(readFileSync(second.path, "utf8")).toBe("Changed text");
    expect(readFileSync(first.path, "utf8")).toBe("Template text");
  });

  it("throws on a write error that is not EEXIST and leaves no file", () => {
    const dataRoot = useTempDir("tasker-archive-");
    const dir = join(dataRoot, "prompts");
    mkdirSync(dir);
    chmodSync(dir, 0o500);

    try {
      expect(() => archivePrompt(dataRoot, "plan", "Template text")).toThrow(
        expect.objectContaining({ code: "EACCES" }),
      );
      expect(existsSync(join(dir, `${promptVersion("plan", "Template text")}.md`))).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it("keeps the text of a file that exists and leaves no other file", () => {
    const dataRoot = useTempDir("tasker-archive-");
    const dir = join(dataRoot, "prompts");
    const path = join(dir, `${promptVersion("plan", "Template text")}.md`);
    mkdirSync(dir);
    writeFileSync(path, "Other text");

    const result = archivePrompt(dataRoot, "plan", "Template text");

    expect(result.path).toBe(path);
    expect(readFileSync(path, "utf8")).toBe("Other text");
    expect(readdirSync(dir)).toEqual([basename(path)]);
  });

  it("refuses a name that holds @ before it writes", () => {
    const dataRoot = useTempDir("tasker-archive-");

    expect(() => archivePrompt(dataRoot, "a@b", "x")).toThrow('prompt name must not hold "@": a@b');
    expect(existsSync(join(dataRoot, "prompts"))).toBe(false);
  });
});
