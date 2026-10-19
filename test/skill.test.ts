import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RegisterCommand } from "../src/cli.js";
import { greet, helpText } from "./helpers/cli.js";
import { commandsInHelp, commandsMissingFromSkill, commandsWithoutReference } from "./skill-coverage.js";

function readSkill(): string {
  return readFileSync(new URL("../skills/tasker/SKILL.md", import.meta.url), "utf8");
}

function skillFrontmatter(): string {
  return /^---\n([\s\S]*?)\n---\n/.exec(readSkill())?.[1] ?? "";
}

function readReferenceFile(file: string): string | undefined {
  const url = new URL(`../skills/tasker/${file}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : undefined;
}

async function missingReferences(
  skill: string,
  readReference: (file: string) => string | undefined,
  commands?: readonly RegisterCommand[],
): Promise<string[]> {
  return commandsWithoutReference(await helpText(commands), skill, readReference);
}

describe("skills/tasker/SKILL.md", () => {
  it("has the name tasker and a description in its frontmatter", () => {
    const frontmatter = skillFrontmatter();
    expect(frontmatter).toMatch(/^name: tasker$/m);
    expect(frontmatter).toMatch(/^description: \S.*$/m);
  });

  it("has the argument-hint of a command line in its frontmatter", () => {
    expect(skillFrontmatter()).toMatch(/^argument-hint: <command> \[arguments\]$/m);
  });

  it("holds the command line of the operator once, in the section Run a command", () => {
    const skill = readSkill();
    const line = "`tasker $ARGUMENTS`";
    expect(skill.split(line).length - 1).toBe(1);
    const start = skill.indexOf("\n## Run a command\n");
    expect(start).not.toBe(-1);
    const end = skill.indexOf("\n## ", start + 1);
    const section = skill.slice(start + 1, end === -1 ? undefined : end);
    expect(section).toContain(line);
    expect(start).toBeLessThan(skill.indexOf("\n## Rules\n"));
  });

  it("reports a command in --help that the skill does not list", async () => {
    expect(commandsMissingFromSkill(await helpText([greet]), "## Commands\n")).toEqual(["greet"]);
  });

  it("accepts a skill that lists each command in --help", async () => {
    const skill = "## Commands\n\n### `tasker greet`\n";
    expect(commandsMissingFromSkill(await helpText([greet]), skill)).toEqual([]);
  });

  it("does not read a wrapped description line as a command", () => {
    const help = [
      "Usage: tasker [options] [command]",
      "",
      "Commands:",
      "  greet [options]  Say hello to the person whose name you give",
      "                   with the --name option",
      "  help [command]   display help for command",
      "",
    ].join("\n");
    expect(commandsInHelp(help)).toEqual(["greet"]);
  });

  it("reads the main name of a command that has an alias", async () => {
    const greetWithAlias: RegisterCommand = (program) => {
      program.command("greet").alias("g").description("Say hello");
    };
    expect(commandsInHelp(await helpText([greetWithAlias]))).toEqual(["greet"]);
  });

  it("lists each command in tasker --help", async () => {
    expect(commandsMissingFromSkill(await helpText(), readSkill())).toEqual([]);
  });

  it("reports a command whose entry has no link to a reference file", async () => {
    const skill = "## Commands\n\n### `tasker greet`\n\nSays hello.\n";
    expect(await missingReferences(skill, () => undefined, [greet])).toEqual(["greet"]);
  });

  it("reports a command whose reference file does not exist", async () => {
    const skill = "### `tasker greet`\n\nSays hello. See [the reference](references/setup.md#tasker-greet).\n";
    expect(await missingReferences(skill, () => undefined, [greet])).toEqual(["greet"]);
  });

  it("reports a command whose reference file lacks its heading", async () => {
    const skill = "### `tasker greet`\n\nSays hello. See [the reference](references/setup.md#tasker-greet).\n";
    const reader = () => "## `tasker other`\n";
    expect(await missingReferences(skill, reader, [greet])).toEqual(["greet"]);
  });

  it("reads the link only from the entry of the command", async () => {
    const skill =
      "### `tasker greet`\n\nSays hello.\n\n### `tasker other`\n\nSee [the reference](references/setup.md#tasker-greet).\n";
    const reader = () => "## `tasker greet`\n";
    expect(await missingReferences(skill, reader, [greet])).toEqual(["greet"]);
  });

  it("accepts an entry that links to the heading of the command in a reference file", async () => {
    const skill = "### `tasker greet`\n\nSays hello. See [the reference](references/setup.md#tasker-greet).\n";
    const reader = () => "# Setup\n\n## `tasker greet`\n";
    expect(await missingReferences(skill, reader, [greet])).toEqual([]);
  });

  it("links each command in tasker --help to its heading in a reference file", async () => {
    expect(await missingReferences(readSkill(), readReferenceFile)).toEqual([]);
  });
});
