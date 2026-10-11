import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { captureIo, greet } from "./helpers.js";

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
    expect(io.err.join("")).toContain("bogus");
    expect(io.err.join("")).toContain("tasker --help");
  });

  it("suggests a similar command for a mistyped command", async () => {
    const io = captureIo();

    const code = await run(["gret"], { commands: [greet], io });

    expect(code).toBe(1);
    expect(io.err.join("")).toContain("unknown command 'gret'");
    expect(io.err.join("")).toContain("Did you mean greet?");
  });

  it("reports a mistyped command before the options of that command", async () => {
    const io = captureIo();

    const code = await run(["gret", "--name", "bob"], { commands: [greet], io });

    expect(code).toBe(1);
    expect(io.err.join("")).toContain("unknown command 'gret'");
    expect(io.err.join("")).toContain("Did you mean greet?");
    expect(io.err.join("")).not.toContain("unknown option");
  });

  it.each([
    { label: "no commands", commands: [] },
    { label: "commands", commands: [greet] },
  ])("prints the --help usage to stderr and fails when given no arguments, with $label", async ({ commands }) => {
    const helpIo = captureIo();
    await run(["--help"], { commands, io: helpIo });

    const io = captureIo();
    const code = await run([], { commands, io });

    expect(code).toBe(1);
    expect(io.out.join("")).toBe("");
    expect(io.err.join("")).toBe(helpIo.out.join(""));
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
