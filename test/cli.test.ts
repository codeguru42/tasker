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

  it("rejects an unknown option and points to --help", async () => {
    const io = captureIo();

    const code = await run(["--bogus"], { commands: [greet], io });

    expect(code).toBe(1);
    expect(io.err.join("")).toContain("unknown option '--bogus'");
    expect(io.err.join("")).toContain("tasker --help");
  });

  it("rejects an unknown option of a command", async () => {
    const io = captureIo();

    const code = await run(["greet", "--bogus"], { commands: [greet], io });

    expect(code).toBe(1);
    expect(io.err.join("")).toContain("unknown option '--bogus'");
  });

  it("rejects an unknown command", async () => {
    const io = captureIo();

    const code = await run(["bogus"], { commands: [greet], io });

    expect(code).toBe(1);
    expect(io.err.join("")).toContain("unknown command 'bogus'");
  });

  it("rejects an unknown command when no commands exist", async () => {
    const io = captureIo();

    const code = await run(["bogus"], { commands: [], io });

    expect(code).toBe(1);
    expect(io.err.join("")).toContain("unknown command 'bogus'");
  });

  it("suggests a similar command for a mistyped command", async () => {
    const io = captureIo();

    const code = await run(["gret"], { commands: [greet], io });

    expect(code).toBe(1);
    expect(io.err.join("")).toContain("unknown command 'gret'");
    expect(io.err.join("")).toContain("Did you mean greet?");
  });

  it("prints usage to stderr and fails when given no arguments", async () => {
    const io = captureIo();

    const code = await run([], { commands: [greet], io });

    expect(code).toBe(1);
    expect(io.err.join("")).toContain("Usage: tasker");
  });

  it("does not show the internal operands placeholder in the usage line", async () => {
    const helpIo = captureIo();

    const helpCode = await run(["--help"], { commands: [greet], io: helpIo });

    expect(helpCode).toBe(0);
    expect(helpIo.out.join("")).toContain("Usage: tasker [options] [command]");
    expect(helpIo.out.join("")).not.toContain("operands");

    const bareIo = captureIo();

    await run([], { commands: [greet], io: bareIo });

    expect(bareIo.err.join("")).not.toContain("operands");
  });
});
