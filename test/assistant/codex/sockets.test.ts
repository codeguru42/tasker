import { realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codexSocketDenyPaths } from "../../../src/assistant/codex/sockets.js";
import { useTempDir } from "../../helpers/temp.js";

describe("codexSocketDenyPaths", () => {
  it("gives the folder under XDG_CONFIG_HOME, and under HOME/.config when that name is not set", () => {
    expect(codexSocketDenyPaths({ XDG_CONFIG_HOME: "/x/cfg", HOME: "/h" })).toEqual(["/x/cfg/herdr"]);
    expect(codexSocketDenyPaths({ HOME: "/h" })).toEqual(["/h/.config/herdr"]);
  });

  it("gives no folder when neither is set, and counts a blank value as not set", () => {
    expect(codexSocketDenyPaths({})).toEqual([]);
    expect(codexSocketDenyPaths({ XDG_CONFIG_HOME: "  ", HOME: "" })).toEqual([]);
    expect(codexSocketDenyPaths({ XDG_CONFIG_HOME: " ", HOME: "/h" })).toEqual(["/h/.config/herdr"]);
  });

  it("makes a relative XDG_CONFIG_HOME absolute", () => {
    expect(codexSocketDenyPaths({ XDG_CONFIG_HOME: "rel/cfg" })).toEqual([resolve("rel/cfg", "herdr")]);
  });

  it("gives the real path of a SSH_AUTH_SOCK that is a link", () => {
    const dir = realpathSync(useTempDir("tasker-sockets-"));
    const target = join(dir, "agent");
    writeFileSync(target, "");
    const link = join(dir, "agent.link");
    symlinkSync(target, link);

    expect(codexSocketDenyPaths({ SSH_AUTH_SOCK: link })).toEqual([target]);
  });

  it("leaves out a SSH_AUTH_SOCK that does not exist", () => {
    const dir = useTempDir("tasker-sockets-");

    expect(codexSocketDenyPaths({ SSH_AUTH_SOCK: join(dir, "missing") })).toEqual([]);
  });

  it("gives no socket when SSH_AUTH_SOCK is not set", () => {
    expect(codexSocketDenyPaths({ HOME: "/h" })).toEqual(["/h/.config/herdr"]);
  });
});
