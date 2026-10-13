import { describe, expect, it } from "vitest";
import { loadsChildProcess, sourceFiles } from "../helpers.js";

// The files under src/ that load child_process.
function childProcessLoaders(): string[] {
  return sourceFiles()
    .filter(({ text }) => loadsChildProcess(text))
    .map(({ file }) => file);
}

describe("the child process boundary", () => {
  it("lets only the modules in src/process/ load child_process", () => {
    const outside = childProcessLoaders().filter((file) => !file.startsWith("process/"));

    expect(outside).toEqual([]);
  });

  it("finds at least one module in src/process/ that loads child_process", () => {
    const inside = childProcessLoaders().filter((file) => file.startsWith("process/"));

    expect(inside).not.toEqual([]);
  });
});
