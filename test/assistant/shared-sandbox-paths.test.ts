import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sharedSandboxPaths } from "../helpers/shared-sandbox-paths.js";

describe("shared sandbox paths", () => {
  it("gives the child temp root from TMPDIR, or /tmp when it is blank or unset", async () => {
    const paths = await sharedSandboxPaths();

    expect(paths.childTempRoot({ TMPDIR: "/t" })).toBe("/t");
    expect(paths.childTempRoot({ TMPDIR: " " })).toBe("/tmp");
    expect(paths.childTempRoot({})).toBe("/tmp");
  });

  it("gives the herdr folder from XDG_CONFIG_HOME or HOME", async () => {
    const paths = await sharedSandboxPaths();

    expect(paths.herdrPath({ XDG_CONFIG_HOME: "/x", HOME: "/h" })).toBe("/x/herdr");
    expect(paths.herdrPath({ HOME: "/h" })).toBe("/h/.config/herdr");
    expect(paths.herdrPath({})).toBeUndefined();
  });

  it("gives an absolute runtime folder from XDG_RUNTIME_DIR", async () => {
    const paths = await sharedSandboxPaths();

    expect(paths.runtimePath({ XDG_RUNTIME_DIR: "rel/run" })).toBe(resolve("rel/run"));
    expect(paths.runtimePath({ XDG_RUNTIME_DIR: " " })).toBeUndefined();
    expect(paths.runtimePath({})).toBeUndefined();
  });

  it("gives the Docker socket path", async () => {
    expect((await sharedSandboxPaths()).DOCKER_SOCKET_PATH).toBe("/var/run/docker.sock");
  });
});
