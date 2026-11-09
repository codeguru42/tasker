import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function childExitCode(code: number | null, signal: string | null): Promise<number> {
  const path = resolve(process.cwd(), "src/process/pi-bwrap.js");
  const module = (await import(path)) as {
    childExitCode(code: number | null, signal: string | null): number;
  };
  return module.childExitCode(code, signal);
}

describe("pi bwrap process exit code", () => {
  it("uses 1 when the child has no exit code or signal", async () => {
    expect(await childExitCode(null, null)).toBe(1);
  });

  it("adds 128 to a signal number", async () => {
    expect(await childExitCode(null, "TERM")).toBe(143);
  });
});
