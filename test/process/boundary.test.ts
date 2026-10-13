import { describe, expect, it } from "vitest";
import { loadsChildProcess, sourceFiles } from "../helpers.js";

describe("the child process boundary", () => {
  it("lets only the modules in src/process/ load child_process", () => {
    const outside = sourceFiles()
      .filter(({ file, text }) => !file.startsWith("process/") && loadsChildProcess(text))
      .map(({ file }) => file);

    expect(outside).toEqual([]);
  });

  it("finds at least one module in src/process/ that loads child_process", () => {
    const inside = sourceFiles()
      .filter(({ file, text }) => file.startsWith("process/") && loadsChildProcess(text))
      .map(({ file }) => file);

    expect(inside).not.toEqual([]);
  });
});
