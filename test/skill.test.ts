import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RegisterCommand } from "../src/cli.js";
import { greet, helpText } from "./helpers/cli.js";
import { commandsInHelp, commandsMissingFromSkill, commandsWithoutReference } from "./skill-coverage.js";

function readSkill(): string {
  return readFileSync(new URL("../skills/tasker/SKILL.md", import.meta.url), "utf8");
}

function runCommandSection(): string {
  const skill = readSkill();
  const start = skill.indexOf("\n## Run a command\n");
  if (start === -1) return "";
  const end = skill.indexOf("\n## ", start + 1);
  return skill.slice(start + 1, end === -1 ? undefined : end);
}

function runCommandText(): string {
  return runCommandSection().replace(/\s+/g, " ");
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
    expect(runCommandSection()).toContain(line);
    expect(skill.indexOf("\n## Run a command\n")).toBeLessThan(skill.indexOf("\n## Rules\n"));
  });

  it("holds the plain placeholder only once", () => {
    expect(readSkill().split("$ARGUMENTS").length - 1).toBe(1);
  });

  it("keeps command chaining disabled by default", () => {
    const section = runCommandText();
    expect(section).toContain(
      "Do not run a next command. The output can name one, for example in a `next:` line. Give that command to the user.",
    );
  });

  it("allows chaining only when the user opts in", () => {
    const section = runCommandText();
    expect(section).toContain(
      "If the user explicitly opts in to chaining in the current request or a standing instruction",
    );
  });

  it("uses a separate tasker show call after each successful command", () => {
    const section = runCommandText();
    expect(section).toContain("run `tasker show <issue>` in a separate shell call");
    expect(section).toContain("Read its `next:` line");
  });

  it("uses the plain form of each chained command", () => {
    const section = runCommandText();
    expect(section).toContain("Each chained call has the form `tasker <command> <issue key>`");
    expect(section).toContain(
      "If the user's first command has `--repo <key>`, carry that option and value into every later call",
    );
    expect(section).toContain("including `tasker show`");
    expect(section).toContain("Never choose from `also:`");
  });

  it("limits rule 2 to before the user's first command", () => {
    expect(runCommandText()).toContain("Rule 2 applies before the user's first command");
  });

  it("reports every tasker call", () => {
    const section = runCommandText();
    expect(section).toContain("each call's exit code, stdout, and stderr");
    expect(section).toContain("including each `tasker show` call");
  });

  it("stops when a command exits with a nonzero code", () => {
    expect(runCommandText()).toContain("Stop when a command exits with a code other than 0");
  });

  it("stops when the user's command takes no issue key or is read-only show", () => {
    expect(runCommandText()).toContain(
      "Stop when the user's command takes no issue key or is a read-only show command",
    );
  });

  it("stops when tasker show has no next line", () => {
    expect(runCommandText()).toContain("Stop when `tasker show` prints no `next:` line");
  });

  it("stops before approve-credits", () => {
    expect(runCommandText()).toContain("when the next command is `approve-credits`");
  });

  it("stops when the next step needs the user's content", () => {
    expect(runCommandText()).toContain("when the next step needs the user's own content");
  });

  it("reports a commands line without choosing a command", () => {
    expect(runCommandText()).toContain("A `commands:` line gives choices and has no `next:` line");
  });

  it("lists the request and the folder of each assistant", () => {
    const heading = "The command line in each assistant:\n\n";
    const section = runCommandSection();
    const start = section.indexOf(heading);
    expect(start).not.toBe(-1);
    const rest = section.slice(start + heading.length);
    const end = rest.indexOf("\n\n");
    const items = (end === -1 ? rest : rest.slice(0, end)).split(/\n(?=- )/).map((item) => item.replace(/\s+/g, " "));
    const claude = items.find((item) => item.startsWith("- Claude Code:")) ?? "";
    const codex = items.find((item) => item.startsWith("- Codex:")) ?? "";
    const pi = items.find((item) => item.startsWith("- pi:")) ?? "";
    expect(claude).toContain("`/tasker <command line>`");
    expect(claude).toContain("`$HOME/.claude/skills`");
    expect(claude).toContain("fills in the placeholder");
    expect(codex).toContain("`$tasker <command line>`");
    expect(codex).toContain("`$HOME/.agents/skills`");
    expect(pi).toContain("/skill:tasker <command line>");
    expect(pi).toContain("$HOME/.agents/skills");
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
