import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installSkillsFrom } from "../../src/commands/install-skills.js";
import { runCommand } from "../helpers/cli.js";
import { useConfigFile, validConfig } from "../helpers/config.js";
import { treeSnapshot, useTempDir, writeFileWithParents } from "../helpers/temp.js";

function makeSource(): string {
  const source = useTempDir("tasker-skills-source-");
  writeFileWithParents(join(source, "tasker", "SKILL.md"), "tasker skill\n");
  writeFileWithParents(join(source, "tasker", "references", "setup.md"), "setup\n");
  writeFileWithParents(join(source, "alpha", "SKILL.md"), "alpha skill\n");
  writeFileWithParents(join(source, "README.md"), "not a skill\n");
  return source;
}

function useSkillsDirs(skillsDirs: string[]): void {
  useConfigFile(() => JSON.stringify({ ...validConfig(), skillsDirs }));
}

function install(source: string) {
  return runCommand(installSkillsFrom(source), "install-skills");
}

function shape(folder: string) {
  return treeSnapshot(folder).map(({ path, type, size }) => ({ path, type, size }));
}

describe("install-skills", () => {
  it("installs each skill into a new folder", async () => {
    const source = makeSource();
    const dir = join(useTempDir("tasker-skills-target-"), "new", "skills");
    useSkillsDirs([dir]);

    const { code, out, err } = await install(source);

    expect(code).toBe(0);
    expect(out).toBe(`installed alpha to ${dir}/alpha\ninstalled tasker to ${dir}/tasker\n`);
    expect(err).toBe("");
    expect(shape(join(dir, "tasker"))).toEqual(shape(join(source, "tasker")));
    expect(shape(join(dir, "alpha"))).toEqual(shape(join(source, "alpha")));
    expect(existsSync(join(dir, "README.md"))).toBe(false);
  });

  it("replaces a skill that exists and removes its extra file", async () => {
    const source = makeSource();
    const dir = useTempDir("tasker-skills-target-");
    writeFileWithParents(join(dir, "tasker", "old.md"), "old\n");
    writeFileWithParents(join(dir, "tasker", "SKILL.md"), "old skill\n");
    useSkillsDirs([dir]);

    const { code } = await install(source);

    expect(code).toBe(0);
    expect(existsSync(join(dir, "tasker", "old.md"))).toBe(false);
    expect(readFileSync(join(dir, "tasker", "SKILL.md"), "utf8")).toBe("tasker skill\n");
  });

  it("installs into each folder of the list, in order", async () => {
    const source = makeSource();
    const base = useTempDir("tasker-skills-target-");
    const first = join(base, "one");
    const second = join(base, "two");
    useSkillsDirs([first, second]);

    const { code, out } = await install(source);

    expect(code).toBe(0);
    expect(out).toBe(
      [
        `installed alpha to ${first}/alpha`,
        `installed tasker to ${first}/tasker`,
        `installed alpha to ${second}/alpha`,
        `installed tasker to ${second}/tasker`,
        "",
      ].join("\n"),
    );
    for (const folder of [first, second]) {
      expect(shape(join(folder, "tasker"))).toEqual(shape(join(source, "tasker")));
      expect(shape(join(folder, "alpha"))).toEqual(shape(join(source, "alpha")));
    }
  });

  it("goes on with the next folder when one folder cannot be written", async () => {
    const source = makeSource();
    const base = useTempDir("tasker-skills-target-");
    const plain = join(base, "file");
    writeFileSync(plain, "plain text\n");
    const bad = join(plain, "skills");
    const good = join(base, "good");
    useSkillsDirs([bad, good]);

    const { code, out, err } = await install(source);

    expect(code).toBe(1);
    expect(err.startsWith(`error: cannot install alpha to ${bad}/alpha: `)).toBe(true);
    expect(err.endsWith("\n")).toBe(true);
    expect(err.split("\n")).toHaveLength(2);
    expect(err).not.toContain("install tasker");
    expect(out).toBe(`installed alpha to ${good}/alpha\ninstalled tasker to ${good}/tasker\n`);
    expect(existsSync(join(good, "tasker", "SKILL.md"))).toBe(true);
    expect(existsSync(join(good, "alpha", "SKILL.md"))).toBe(true);
    expect(readFileSync(plain, "utf8")).toBe("plain text\n");
    expect(existsSync(bad)).toBe(false);
  });

  it("copies nothing when the configuration does not load", async () => {
    const source = makeSource();
    const dir = join(useTempDir("tasker-skills-target-"), "good");
    useSkillsDirs([dir, "rel"]);

    const { code, out, err } = await install(source);

    expect(code).toBe(1);
    expect(err).toContain("skillsDirs.1");
    expect(existsSync(dir)).toBe(false);
    expect(out).toBe("");
  });
});
