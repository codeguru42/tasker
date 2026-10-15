import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createDefaultIo, type RegisterCommand, run } from "../src/cli.js";
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

  it("gives --version after a command to that command", async () => {
    const sp: RegisterCommand = (program, io) => {
      program
        .command("sp")
        .option("--version <n>", "The plan version")
        .action((options: { version?: string }) => io.stdout(`${options.version}\n`));
    };
    const io = captureIo();

    const code = await run(["sp", "--version", "2"], { commands: [sp], io });

    expect(code).toBe(0);
    expect(io.out.join("")).toBe("2\n");
  });

  it("hands the Io to each command", async () => {
    const say: RegisterCommand = (program, io) => {
      program.command("say").action(() => io.stdout("hi\n"));
    };
    const io = captureIo();

    const code = await run(["say"], { commands: [say], io });

    expect(code).toBe(0);
    expect(io.out.join("")).toBe("hi\n");
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

describe("createDefaultIo", () => {
  function streams(isTTY: boolean, ttyOutput = false) {
    const stdin = Object.assign(new PassThrough(), { isTTY });
    const stdout = new PassThrough();
    const stderr = Object.assign(new PassThrough(), { isTTY: ttyOutput });
    return { stdin, stdout, stderr };
  }

  it("has no prompt when stdin is not a terminal", () => {
    expect(createDefaultIo(streams(false)).prompt).toBeUndefined();
  });

  it("writes the question to stderr and resolves the line", async () => {
    const s = streams(true);
    const io = createDefaultIo(s);
    const chunks: string[] = [];
    s.stderr.on("data", (chunk) => chunks.push(String(chunk)));

    const answer = io.prompt?.("Base branch: ");
    s.stdin.write("dev\n");

    await expect(answer).resolves.toBe("dev");
    expect(chunks.join("")).toContain("Base branch: ");
    expect(s.stdin.isPaused()).toBe(true);
  });

  it("holds no input listener until a prompt runs", () => {
    const s = streams(true);
    createDefaultIo(s);

    expect(s.stdin.listenerCount("data")).toBe(0);
    expect(s.stdin.listenerCount("keypress")).toBe(0);
  });

  it("rejects when the input closes with no line", async () => {
    const s = streams(true);
    const answer = createDefaultIo(s).prompt?.("Base branch: ");
    s.stdin.end();

    await expect(answer).rejects.toThrow("no answer: the input closed");
  });

  it("rejects when the question is cancelled with Ctrl-C", async () => {
    // A terminal output puts readline in terminal mode, where Ctrl-C is a key.
    const s = streams(true, true);
    const answer = createDefaultIo(s).prompt?.("Base branch: ");
    // The test writes the raw byte to stdin.
    s.stdin.write("\x03");
    const unsettled = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("the prompt did not settle")), 1000).unref();
    });

    await expect(Promise.race([answer, unsettled])).rejects.toThrow(
      "no answer: the question was cancelled",
    );
    expect(s.stdin.isPaused()).toBe(true);
  });
});
