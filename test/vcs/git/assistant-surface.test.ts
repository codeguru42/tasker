import { userInfo } from "node:os";
import { describe, expect, it } from "vitest";
import {
  DENY_RULES,
  EXECUTE_COMMIT_TEXT,
  readDenyPaths,
} from "../../../src/vcs/git/assistant-surface.js";

const EXPECTED = [
  "Commit each red/green pair, or each completed todo, as its own commit. Never collect the whole plan into one commit at the end. If a run stops partway (a quota limit, a timeout), the work that it finished must stay committed.",
  "The branch can already hold commits from an earlier execute run of an earlier revision of this plan. Before you start, run `git log --reverse {{BASE_REF}}..HEAD` and read what is there. Build on that work. Do not do it again.",
].join("\n\n");

describe("assistant surface values", () => {
  it("gives the commit rules of the execute prompt", () => {
    expect(EXECUTE_COMMIT_TEXT).toBe(EXPECTED);
  });

  it("denies git push in the shell of the assistant", () => {
    expect(DENY_RULES).toEqual(["Bash(git push:*)"]);
  });

  it("gives an absolute ssh key as it is", () => {
    expect(readDenyPaths({ sshKey: "/keys/id_tasker" })).toEqual(["/keys/id_tasker"]);
  });

  it("expands a ~/ ssh key with the home folder", () => {
    expect(readDenyPaths({ sshKey: "~/.ssh/id_tasker" })).toEqual([
      `${userInfo().homedir}/.ssh/id_tasker`,
    ]);
  });

  it.each(["~alice/.ssh/id", "~"])("throws for the ssh key %s", (key) => {
    expect(() => readDenyPaths({ sshKey: key })).toThrow(
      `cannot resolve the ssh key path for the sandbox: ${key}`,
    );
  });

  it("gives no path when no ssh key is set", () => {
    expect(readDenyPaths({})).toEqual([]);
  });
});
