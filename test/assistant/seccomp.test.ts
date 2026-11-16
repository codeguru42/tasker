import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface SeccompModule {
  unixSocketFilter(arch: string): Buffer | undefined;
  seccompArchRefusal(arch: string): string;
}

async function loadSeccomp(): Promise<SeccompModule> {
  const path = resolve(process.cwd(), "src/assistant/seccomp.js");
  return (await import(path)) as SeccompModule;
}

// The rows of the program: code, jt, jf, k.
const ROWS: [number, number, number, number][] = [
  [0x20, 0, 0, 4],
  [0x15, 1, 0, 0xc000003e],
  [0x06, 0, 0, 0x80000000],
  [0x20, 0, 0, 0],
  [0x35, 0, 1, 0x40000000],
  [0x06, 0, 0, 0x80000000],
  [0x15, 4, 0, 41],
  [0x15, 2, 0, 425],
  [0x15, 1, 0, 426],
  [0x15, 0, 4, 427],
  [0x06, 0, 0, 0x00050001],
  [0x20, 0, 0, 16],
  [0x15, 0, 1, 1],
  [0x06, 0, 0, 0x00050001],
  [0x06, 0, 0, 0x7fff0000],
];

function expectedBytes(): Buffer {
  const buffer = Buffer.alloc(ROWS.length * 8);
  ROWS.forEach(([code, jt, jf, k], index) => {
    const offset = index * 8;
    buffer.writeUInt16LE(code, offset);
    buffer.writeUInt8(jt, offset + 2);
    buffer.writeUInt8(jf, offset + 3);
    buffer.writeUInt32LE(k, offset + 4);
  });
  return buffer;
}

describe("unixSocketFilter", () => {
  it("gives the 120 bytes of the table for x64", async () => {
    const seccomp = await loadSeccomp();
    const filter = seccomp.unixSocketFilter("x64");
    expect(filter?.length).toBe(120);
    expect(filter?.equals(expectedBytes())).toBe(true);
  });

  it("gives a new buffer on each call", async () => {
    const seccomp = await loadSeccomp();
    const first = seccomp.unixSocketFilter("x64");
    const second = seccomp.unixSocketFilter("x64");
    expect(first).not.toBe(second);
    first?.fill(0);
    expect(seccomp.unixSocketFilter("x64")?.equals(expectedBytes())).toBe(true);
  });

  it.each(["arm64", "ia32", "x32", ""])("gives undefined for the architecture %j", async (arch) => {
    const seccomp = await loadSeccomp();
    expect(seccomp.unixSocketFilter(arch)).toBeUndefined();
  });
});

describe("seccompArchRefusal", () => {
  it("gives the reason text", async () => {
    const seccomp = await loadSeccomp();
    expect(seccomp.seccompArchRefusal("arm64")).toBe(
      "the seccomp filter of the sandbox does not support the architecture arm64",
    );
  });
});
