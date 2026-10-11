import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run, type Io, type RegisterCommand } from "../src/cli.js";
import { commandsInHelp, commandsMissingFromSkill } from "./skill-coverage.js";

function readSkill(): string {
  return readFileSync(new URL("../skills/tasker/SKILL.md", import.meta.url), "utf8");
}

interface CapturedIo extends Io {
  out: string[];
  err: string[];
}

function captureIo(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
}

const greet: RegisterCommand = (program) => {
  program
    .command("greet")
    .description("Say hello")
    .option("--name <name>", "Who to greet");
};

async function helpText(commands?: readonly RegisterCommand[]): Promise<string> {
  const io = captureIo();
  const code = await run(["--help"], commands ? { commands, io } : { io });
  expect(code).toBe(0);
  return io.out.join("");
}

describe("skills/tasker/SKILL.md", () => {
  it("has the name tasker and a description in its frontmatter", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(readSkill())?.[1] ?? "";
    expect(frontmatter).toMatch(/^name: tasker$/m);
    expect(frontmatter).toMatch(/^description: \S.*$/m);
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

  it("lists each command in tasker --help", async () => {
    expect(commandsMissingFromSkill(await helpText(), readSkill())).toEqual([]);
  });
});
