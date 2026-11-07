import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { piChildEnv as fromPiChildEnv } from "../../../src/assistant/pi/child-env.js";

function piChildEnv(env: NodeJS.ProcessEnv) {
  return fromPiChildEnv(env);
}

describe("piChildEnv", () => {
  it("keeps an absolute agent folder", () => {
    expect(piChildEnv({ HOME: "/home/user", TASKER_PI_CODING_AGENT_DIR: "/custom/pi" })).toEqual({
      env: { HOME: "/home/user", PI_CODING_AGENT_DIR: "/custom/pi" },
    });
  });

  it("resolves a relative agent folder and HOME from the working folder", () => {
    expect(piChildEnv({ HOME: "home/user" })).toEqual({
      env: { HOME: "home/user", PI_CODING_AGENT_DIR: resolve("home/user/.pi/agent") },
    });
  });

  it.each(["rel/x", "~/x", "file:///x"])("rejects a non-absolute custom folder %s", (folder) => {
    expect(piChildEnv({ HOME: "/home/user", TASKER_PI_CODING_AGENT_DIR: folder })).toEqual({
      reason: `TASKER_PI_CODING_AGENT_DIR must be an absolute path, got ${folder}`,
    });
  });

  it("uses the default agent folder when the custom folder is blank", () => {
    expect(piChildEnv({ HOME: "/home/user", TASKER_PI_CODING_AGENT_DIR: " " })).toEqual({
      env: { HOME: "/home/user", PI_CODING_AGENT_DIR: "/home/user/.pi/agent" },
    });
  });

  it("reports a missing HOME when no custom folder is set", () => {
    expect(piChildEnv({})).toEqual({ reason: "tasker cannot find the agent folder of pi, because HOME is not set" });
  });

  it("reports a relative custom folder before a missing HOME", () => {
    expect(piChildEnv({ TASKER_PI_CODING_AGENT_DIR: "rel/x" })).toEqual({
      reason: "TASKER_PI_CODING_AGENT_DIR must be an absolute path, got rel/x",
    });
  });

  it("drops TASKER_ names and adds the pi folder name", () => {
    const result = piChildEnv({
      HOME: "/home/user",
      TASKER_PI_CODING_AGENT_DIR: "/custom/pi",
      TASKER_OTHER: "secret",
    });
    expect(result).toEqual({ env: { HOME: "/home/user", PI_CODING_AGENT_DIR: "/custom/pi" } });
  });
});
