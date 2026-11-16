import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../helpers/temp.js";

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

interface PiBwrapTestOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  onData(data: Buffer): void;
  fd3?: Buffer;
}

async function spawnPiBwrap(program: string, args: readonly string[], options: PiBwrapTestOptions): Promise<number> {
  const path = resolve(process.cwd(), "src/process/pi-bwrap.js");
  const module = (await import(path)) as {
    spawnPiBwrap(program: string, args: readonly string[], options: PiBwrapTestOptions): Promise<number>;
  };
  return module.spawnPiBwrap(program, args, options);
}

async function runShell(script: string, fd3?: Buffer): Promise<{ code: number; output: Buffer }> {
  const chunks: Buffer[] = [];
  const code = await spawnPiBwrap("/bin/sh", ["-c", script], {
    cwd: useTempDir("tasker-pi-bwrap-"),
    env: { PATH: process.env.PATH },
    onData: (data) => chunks.push(data),
    ...(fd3 === undefined ? {} : { fd3 }),
  });
  return { code, output: Buffer.concat(chunks) };
}

describe("spawnPiBwrap fd3", () => {
  it("writes fd3 to a pipe at fd 3 and closes it", async () => {
    const fd3 = Buffer.from([0, 1, 2, 255, 10, 0, 7]);

    const result = await runShell("cat <&3", fd3);

    expect(result.code).toBe(0);
    expect(result.output.equals(fd3)).toBe(true);
  });

  it("leaves fd 3 closed without fd3", async () => {
    const result = await runShell("( : <&3 ) 2>/dev/null && echo open || echo closed");

    expect(result.code).toBe(0);
    expect(result.output.toString().trim()).toBe("closed");
  });

  it("ignores an error of the fd 3 pipe", async () => {
    const result = await runShell("exec 3<&-; exit 5", Buffer.alloc(1024 * 1024, 1));

    expect(result.code).toBe(5);
  });
});
