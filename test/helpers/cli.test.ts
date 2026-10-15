import { describe, expect, it } from "vitest";
import { captureIo, greet, runCommand } from "./cli.js";

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
