import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "./temp.js";
import {
  fakeAnswerScript,
  logEnvItems,
  pathWithFirst,
  readFakeCalls,
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

describe("fakeAnswerScript", () => {
  const setup = () => {
    const dir = useTempDir("tasker-answer-");
    const logPath = join(dir, "tool.log");
    const bin = join(dir, "bin");
    const answers = [{ args: ["ask"], stdout: "out", stderr: "err", exitCode: 3 }];
    writeFakeCommand(bin, "tool", fakeAnswerScript("tool", logPath, answers, []));
    return { bin, logPath };
  };

  it("answers a listed call", () => {
    const { bin, logPath } = setup();

    const result = spawnSync(join(bin, "tool"), ["ask"], { env: { PATH: bin }, encoding: "utf8" });

    expect(result.stdout).toBe("out");
    expect(result.stderr).toBe("err");
    expect(result.status).toBe(3);
    expect(readFileSync(logPath, "utf8")).toContain("ask");
  });

  it("exits 99 for an unlisted call and logs it as unanswered", () => {
    const { bin, logPath } = setup();

    const result = spawnSync(join(bin, "tool"), ["other"], { env: { PATH: bin }, encoding: "utf8" });

    expect(result.status).toBe(99);
    expect(result.stderr).toBe("fake tool: no answer for: other\n");
    expect(readFileSync(`${logPath}.unanswered`, "utf8")).toContain("other");
  });

  it("throws for a bad delay", () => {
    expect(() => fakeAnswerScript("tool", "/x.log", [{ args: [], delaySeconds: -1 }], [])).toThrow(
      "bad delay for the fake tool: -1",
    );
  });
});

describe("logEnvItems", () => {
  it("gives the log item of each name", () => {
    expect(logEnvItems("tool", ["A", "B_1"])).toEqual(['"${A+set:$A}"', '"${B_1+set:$B_1}"']);
  });

  it("gives an empty list for no names", () => {
    expect(logEnvItems("tool", [])).toEqual([]);
  });

  it("throws for a name that starts with a digit", () => {
    expect(() => logEnvItems("tool", ["1A"])).toThrow("bad env name for the fake tool: 1A");
  });

  it("throws for a name with a hyphen", () => {
    expect(() => logEnvItems("tool", ["A-B"])).toThrow("bad env name for the fake tool: A-B");
  });

  it("round-trips with readFakeCalls", () => {
    const dir = useTempDir("tasker-env-items-");
    const logPath = join(dir, "tool.log");
    const bin = join(dir, "bin");
    writeFakeCommand(
      bin,
      "tool",
      fakeAnswerScript("tool", logPath, [{ args: ["go"] }], logEnvItems("tool", ["A", "B"])),
    );

    spawnSync(join(bin, "tool"), ["go"], { env: { PATH: bin, B: "x" } });

    expect(readFakeCalls(logPath, 0, ["A", "B"])).toEqual([
      { leading: [], args: ["go"], env: { A: undefined, B: "x" } },
    ]);
  });
});

describe("readFakeCalls", () => {
  it("gives undefined for an unset item and the value for set:<value>", () => {
    const dir = useTempDir("tasker-calls-");
    const logPath = join(dir, "tool.log");
    const bin = join(dir, "bin");
    const extra = ['"${A+set:$A}"', '"${B+set:$B}"'];
    writeFakeCommand(bin, "tool", fakeAnswerScript("tool", logPath, [{ args: ["go"] }], extra));

    spawnSync(join(bin, "tool"), ["go"], { env: { PATH: bin, B: "x" } });

    expect(readFakeCalls(logPath, 1, ["B"])).toEqual([{ leading: [undefined], args: ["go"], env: { B: "x" } }]);
  });
});
