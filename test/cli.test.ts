import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run, type Io, type RegisterCommand } from "../src/cli.js";

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

const packageVersion: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

describe("run", () => {
  it("prints the package version for --version", async () => {
    const io = captureIo();

    const code = await run(["--version"], { commands: [], io });

    expect(code).toBe(0);
    expect(io.out.join("")).toBe(`${packageVersion}\n`);
  });

  it("lists commands in --help", async () => {
    const io = captureIo();

    const code = await run(["--help"], { commands: [greet], io });

    expect(code).toBe(0);
    expect(io.out.join("")).toContain("greet");
    expect(io.out.join("")).toContain("Say hello");
  });

  it("lists the options of a command in <command> --help", async () => {
    const io = captureIo();

    const code = await run(["greet", "--help"], { commands: [greet], io });

    expect(code).toBe(0);
    expect(io.out.join("")).toContain("--name <name>");
    expect(io.out.join("")).toContain("Who to greet");
  });
});
