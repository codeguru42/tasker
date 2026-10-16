import { describe, expect, it } from "vitest";
import type { RegisterCommand } from "../../src/cli.js";
import { captureIo, greet, runCommand, runHelp } from "./cli.js";

describe("runCommand", () => {
  it("gives the help text and code 0 for --help", async () => {
    const result = await runCommand(greet, "greet", "--help");

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toContain("Say hello");
    expect(result.out).toContain("Who to greet");
  });

  it("gives code 1 and an error on stderr for an unknown option", async () => {
    const result = await runCommand(greet, "greet", "--bogus");

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("--bogus");
  });
});

describe("runHelp", () => {
  it("gives code 0 and the help text of the command", async () => {
    const { code, help } = await runHelp(greet, "greet");

    expect(code).toBe(0);
    expect(help).toContain("Say hello");
    expect(help).toContain("--name <name> Who to greet");
  });

  it("joins a wrapped description to one line", async () => {
    const description =
      "Say hello to the person whose name you give with the name option, and then say goodbye to that same person";
    const longGreet: RegisterCommand = (program) => {
      program.command("greet").description(description);
    };

    const { help } = await runHelp(longGreet, "greet");

    expect(help).toContain(description);
    expect(help).not.toMatch(/\s{2,}|\n/);
  });
});

describe("captureIo", () => {
  it("has no prompt with no options", () => {
    expect(captureIo().prompt).toBeUndefined();
  });

  it("answers each question in turn and records it", async () => {
    const io = captureIo({ answers: ["a", "b"] });
    await expect(io.prompt?.("first? ")).resolves.toBe("a");
    await expect(io.prompt?.("second? ")).resolves.toBe("b");
    expect(io.questions).toEqual(["first? ", "second? "]);
  });

  it("rejects when no answer is left", async () => {
    const io = captureIo({ answers: [] });
    await expect(io.prompt?.("more? ")).rejects.toThrow();
    expect(io.questions).toEqual(["more? "]);
  });
});
