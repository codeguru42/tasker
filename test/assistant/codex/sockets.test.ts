import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codexSocketDenyPaths } from "../../../src/assistant/codex/sockets.js";
import { useTempDir } from "../../helpers/temp.js";

describe("codexSocketDenyPaths", () => {
  it("gives the folder under XDG_CONFIG_HOME, and under HOME/.config when that name is not set", () => {
    expect(codexSocketDenyPaths({ XDG_CONFIG_HOME: "/x/cfg", HOME: "/h" }, "/missing-docker-socket")).toEqual([
      "/x/cfg/herdr",
    ]);
    expect(codexSocketDenyPaths({ HOME: "/h" }, "/missing-docker-socket")).toEqual(["/h/.config/herdr"]);
  });

  it("gives no folder when neither is set, and counts a blank value as not set", () => {
    expect(codexSocketDenyPaths({}, "/missing-docker-socket")).toEqual([]);
    expect(codexSocketDenyPaths({ XDG_CONFIG_HOME: "  ", HOME: "" }, "/missing-docker-socket")).toEqual([]);
    expect(codexSocketDenyPaths({ XDG_CONFIG_HOME: " ", HOME: "/h" }, "/missing-docker-socket")).toEqual([
      "/h/.config/herdr",
    ]);
  });

  it("makes a relative XDG_CONFIG_HOME absolute", () => {
    expect(codexSocketDenyPaths({ XDG_CONFIG_HOME: "rel/cfg" }, "/missing-docker-socket")).toEqual([
      resolve("rel/cfg", "herdr"),
    ]);
  });

  it("gives the real path of a SSH_AUTH_SOCK that is a link", () => {
    const dir = realpathSync(useTempDir("tasker-sockets-"));
    const target = join(dir, "agent");
    writeFileSync(target, "");
    const link = join(dir, "agent.link");
    symlinkSync(target, link);

    expect(codexSocketDenyPaths({ SSH_AUTH_SOCK: link }, "/missing-docker-socket")).toEqual([target]);
  });

  it("leaves out a SSH_AUTH_SOCK that does not exist", () => {
    const dir = useTempDir("tasker-sockets-");

    expect(codexSocketDenyPaths({ SSH_AUTH_SOCK: join(dir, "missing") }, "/missing-docker-socket")).toEqual([]);
  });

  it("gives no socket when SSH_AUTH_SOCK is not set", () => {
    expect(codexSocketDenyPaths({ HOME: "/h" }, "/missing-docker-socket")).toEqual(["/h/.config/herdr"]);
  });

  it("gives the real runtime folder", () => {
    const dir = realpathSync(useTempDir("tasker-runtime-"));
    expect(codexSocketDenyPaths({ XDG_RUNTIME_DIR: dir }, "/missing-docker-socket")).toEqual([dir]);
  });

  it("gives the real runtime folder through a link", () => {
    const dir = realpathSync(useTempDir("tasker-runtime-"));
    const link = join(dir, "runtime.link");
    symlinkSync(dir, link);
    expect(codexSocketDenyPaths({ XDG_RUNTIME_DIR: link }, "/missing-docker-socket")).toEqual([dir]);
  });

  it("gives the real runtime folder through a linked parent", () => {
    const dir = realpathSync(useTempDir("tasker-runtime-"));
    const parent = join(dir, "real");
    mkdirSync(parent);
    const link = join(dir, "parent.link");
    symlinkSync(parent, link);
    mkdirSync(join(parent, "child"));
    expect(codexSocketDenyPaths({ XDG_RUNTIME_DIR: join(link, "child") }, "/missing-docker-socket")).toEqual([
      join(parent, "child"),
    ]);
  });

  it("leaves out unset and blank runtime folders", () => {
    expect(codexSocketDenyPaths({}, "/missing-docker-socket")).toEqual([]);
    expect(codexSocketDenyPaths({ XDG_RUNTIME_DIR: "  " }, "/missing-docker-socket")).toEqual([]);
  });

  it("makes a relative runtime folder absolute", () => {
    const dir = realpathSync(useTempDir("tasker-runtime-"));
    const path = relative(process.cwd(), dir);
    expect(codexSocketDenyPaths({ XDG_RUNTIME_DIR: path }, "/missing-docker-socket")).toEqual([resolve(path)]);
  });

  it("gives the real Docker socket path", () => {
    const dir = realpathSync(useTempDir("tasker-docker-"));
    const docker = join(dir, "docker.sock");
    writeFileSync(docker, "");
    expect(codexSocketDenyPaths({}, docker)).toEqual([docker]);
  });

  it("gives the real Docker socket path through a linked parent", () => {
    const dir = realpathSync(useTempDir("tasker-docker-"));
    const realParent = join(dir, "real");
    mkdirSync(realParent);
    const docker = join(realParent, "docker.sock");
    writeFileSync(docker, "");
    const link = join(dir, "parent.link");
    symlinkSync(realParent, link);
    expect(codexSocketDenyPaths({}, join(link, "docker.sock"))).toEqual([docker]);
  });

  it("omits missing runtime and Docker paths", () => {
    expect(codexSocketDenyPaths({ XDG_RUNTIME_DIR: "/tasker-no-such-runtime" }, "/tasker-no-such-docker")).toEqual([]);
  });

  it("keeps herdr, SSH, runtime and Docker paths in order", () => {
    const dir = realpathSync(useTempDir("tasker-sockets-"));
    const agent = join(dir, "agent");
    const runtime = join(dir, "runtime");
    const docker = join(dir, "docker.sock");
    mkdirSync(runtime);
    writeFileSync(agent, "");
    writeFileSync(docker, "");
    expect(codexSocketDenyPaths({ HOME: dir, SSH_AUTH_SOCK: agent, XDG_RUNTIME_DIR: runtime }, docker)).toEqual([
      join(dir, ".config", "herdr"),
      agent,
      runtime,
      docker,
    ]);
  });

  it("propagates runtime realpath errors other than missing paths", () => {
    const dir = realpathSync(useTempDir("tasker-runtime-"));
    const loop = join(dir, "loop");
    symlinkSync(loop, loop);
    expect(() => codexSocketDenyPaths({ XDG_RUNTIME_DIR: loop }, "/missing-docker-socket")).toThrow();
  });
});
