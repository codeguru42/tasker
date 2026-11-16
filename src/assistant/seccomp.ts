// The seccomp filter of the sandboxes. The pi sandbox uses it now. Issue #935 reuses
// `unixSocketFilter()` and `seccompArchRefusal()` for the codex sandbox.

// One instruction of a classic BPF program: code, jt, jf and k.
type Row = readonly [code: number, jt: number, jf: number, k: number];

// The program blocks each new AF_UNIX socket and the three io_uring calls.
// The jump offsets count instructions after the current one.
const X64_ROWS: readonly Row[] = [
  // 0: load the architecture of the call.
  [0x20, 0, 0, 4],
  // 1: if it is x86-64, skip the next instruction.
  [0x15, 1, 0, 0xc000003e],
  // 2: any other architecture: kill the process.
  [0x06, 0, 0, 0x80000000],
  // 3: load the call number.
  [0x20, 0, 0, 0],
  // 4: if the x32 bit is set, do not skip the kill.
  [0x35, 0, 1, 0x40000000],
  // 5: an x32 call number: kill the process.
  [0x06, 0, 0, 0x80000000],
  // 6: socket (41): go to row 11.
  [0x15, 4, 0, 41],
  // 7: io_uring_setup (425): go to row 10.
  [0x15, 2, 0, 425],
  // 8: io_uring_enter (426): go to row 10.
  [0x15, 1, 0, 426],
  // 9: io_uring_register (427): go on to row 10, else go to row 14.
  [0x15, 0, 4, 427],
  // 10: fail an io_uring call with EPERM.
  [0x06, 0, 0, 0x00050001],
  // 11: load the low 32 bits of the first argument of socket (the domain).
  [0x20, 0, 0, 16],
  // 12: if the domain is AF_UNIX (1), go on to row 13, else go to row 14.
  [0x15, 0, 1, 1],
  // 13: fail an AF_UNIX socket with EPERM.
  [0x06, 0, 0, 0x00050001],
  // 14: allow each other call.
  [0x06, 0, 0, 0x7fff0000],
];

// Gives a new buffer of the program for x64, and undefined for each other architecture.
export function unixSocketFilter(arch: string): Buffer | undefined {
  if (arch !== "x64") {
    return undefined;
  }
  const buffer = Buffer.alloc(X64_ROWS.length * 8);
  X64_ROWS.forEach(([code, jt, jf, k], index) => {
    const offset = index * 8;
    buffer.writeUInt16LE(code, offset);
    buffer.writeUInt8(jt, offset + 2);
    buffer.writeUInt8(jf, offset + 3);
    buffer.writeUInt32LE(k, offset + 4);
  });
  return buffer;
}

export function seccompArchRefusal(arch: string): string {
  return `the seccomp filter of the sandbox does not support the architecture ${arch}`;
}
