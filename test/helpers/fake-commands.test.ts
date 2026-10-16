import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "./temp.js";
import {
  pathWithFirst,
  usePathWithout,
  useFakeSandboxBin,
  writeFakeCommand,
  writeFakeSandboxPrograms,
} from "./fake-commands.js";

const runs = (program: string, folder: string) => spawnSync(program, [], { env: { PATH: folder } });

describe("writeFakeSandboxPrograms", () => {
  it("writes bwrap and socat that exit 0", () => {
    const bin = useTempDir("tasker-bin-");

    writeFakeSandboxPrograms(bin);

    expect(runs("bwrap", bin).status).toBe(0);
    expect(runs("socat", bin).status).toBe(0);
  });

  it("skips the names in the except list", () => {
    const bin = useTempDir("tasker-bin-");

    writeFakeSandboxPrograms(bin, ["socat"]);

    expect(runs("bwrap", bin).status).toBe(0);
    expect(existsSync(join(bin, "socat"))).toBe(false);
  });
});

describe("useFakeSandboxBin", () => {
  it("gives a new folder with bwrap and socat that exit 0", () => {
    const bin = useFakeSandboxBin();

    expect(runs("bwrap", bin).status).toBe(0);
    expect(runs("socat", bin).status).toBe(0);
  });

  it("leaves out the names in the except list", () => {
    const bin = useFakeSandboxBin(["bwrap"]);

    expect(existsSync(join(bin, "bwrap"))).toBe(false);
    expect(runs("socat", bin).status).toBe(0);
  });
});

describe("usePathWithout", () => {
  it("hides the program and keeps the other programs of its folder and of the other folders", () => {
    const withClaude = join(useTempDir("tasker-bin-"), "bin");
    const other = join(useTempDir("tasker-bin-"), "bin");
    writeFakeCommand(withClaude, "claude", "exit 0");
    writeFakeCommand(withClaude, "tool", "exit 0");
    writeFakeCommand(other, "other", "exit 0");
    const path = [withClaude, other].join(delimiter);

    const changed = usePathWithout("claude", path);

    expect(runs("claude", path).status).toBe(0);
    expect((runs("claude", changed).error as NodeJS.ErrnoException).code).toBe("ENOENT");
    expect(runs("tool", changed).status).toBe(0);
    expect(runs("other", changed).status).toBe(0);
  });

  it("keeps the exact string and the place of a folder without the program", () => {
    const withClaude = join(useTempDir("tasker-bin-"), "bin");
    const other = join(useTempDir("tasker-bin-"), "bin");
    writeFakeCommand(withClaude, "claude", "exit 0");
    writeFakeCommand(other, "other", "exit 0");

    const folders = usePathWithout("claude", [other, withClaude, other].join(delimiter)).split(delimiter);

    expect(folders).toHaveLength(3);
    expect(folders[0]).toBe(other);
    expect(folders[1]).not.toBe(withClaude);
    expect(folders[2]).toBe(other);
  });

  it("gives a PATH without the program as it is", () => {
    const other = join(useTempDir("tasker-bin-"), "bin");
    writeFakeCommand(other, "other", "exit 0");
    const path = [other, "/no/such/folder"].join(delimiter);

    expect(usePathWithout("claude", path)).toBe(path);
  });
});

describe("pathWithFirst", () => {
  it("puts the folder first on the PATH of the base env", () => {
    expect(pathWithFirst("/first", { PATH: `/a${delimiter}/b` })).toBe(`/first${delimiter}/a${delimiter}/b`);
  });

  it("gives the folder alone when the base env has no PATH", () => {
    expect(pathWithFirst("/first", {})).toBe("/first");
  });

  it("gives the folder alone when the PATH of the base env is empty", () => {
    expect(pathWithFirst("/first", { PATH: "" })).toBe("/first");
  });
});
