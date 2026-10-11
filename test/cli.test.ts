import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run, type Io } from "../src/cli.js";

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
});
