import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { childTempRoot, DOCKER_SOCKET_PATH, herdrPath, runtimePath } from "../../src/assistant/shared-sandbox-paths.js";

describe("shared sandbox paths", () => {
  it("gives the child temp root from TMPDIR, or /tmp when it is blank or unset", async () => {
    expect(childTempRoot({ TMPDIR: "/t" })).toBe("/t");
    expect(childTempRoot({ TMPDIR: " " })).toBe("/tmp");
    expect(childTempRoot({})).toBe("/tmp");
  });

  it("gives the herdr folder from XDG_CONFIG_HOME or HOME", async () => {
    expect(herdrPath({ XDG_CONFIG_HOME: "/x", HOME: "/h" })).toBe("/x/herdr");
    expect(herdrPath({ HOME: "/h" })).toBe("/h/.config/herdr");
    expect(herdrPath({})).toBeUndefined();
  });

  it("gives an absolute runtime folder from XDG_RUNTIME_DIR", async () => {
    expect(runtimePath({ XDG_RUNTIME_DIR: "rel/run" })).toBe(resolve("rel/run"));
    expect(runtimePath({ XDG_RUNTIME_DIR: " " })).toBeUndefined();
    expect(runtimePath({})).toBeUndefined();
  });

  it("gives the Docker socket path", async () => {
    expect(DOCKER_SOCKET_PATH).toBe("/var/run/docker.sock");
  });
});
