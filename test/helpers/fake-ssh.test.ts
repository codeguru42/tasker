import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeSsh } from "./fake-ssh.js";
import { gitTestEnv } from "./git.js";
import { useTempDir } from "./temp.js";

describe("fakeSsh", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-fake-ssh-");
  });

  it("puts the bin folder first on the PATH", () => {
    const ssh = fakeSsh(dir, gitTestEnv(dir), "serve");
    expect(ssh.env.PATH?.startsWith(join(dir, "bin") + delimiter)).toBe(true);
  });

  it("gives the ssh remote of a repo path", () => {
    const ssh = fakeSsh(dir, gitTestEnv(dir), "serve");
    expect(ssh.remote("/x/o.git")).toBe("ssh://tasker.invalid/x/o.git");
  });

  it("writes the fake ssh into the bin folder", () => {
    fakeSsh(dir, gitTestEnv(dir), "refuse");
    expect(existsSync(join(dir, "bin", "ssh"))).toBe(true);
  });
});
