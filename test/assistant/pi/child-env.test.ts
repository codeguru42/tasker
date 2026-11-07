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

  it("refuses a relative HOME when the custom folder is unset", () => {
    expect(piChildEnv({ HOME: "rel/h" })).toEqual({
      reason: "HOME must be an absolute path, got rel/h",
    });
  });

  it("refuses a relative HOME when the custom folder is blank", () => {
    expect(piChildEnv({ HOME: "rel/h", TASKER_PI_CODING_AGENT_DIR: " " })).toEqual({
      reason: "HOME must be an absolute path, got rel/h",
    });
  });

  it("uses an absolute custom folder with a relative HOME", () => {
    expect(piChildEnv({ HOME: "rel/h", TASKER_PI_CODING_AGENT_DIR: "/p" })).toEqual({
      env: { HOME: "rel/h", PI_CODING_AGENT_DIR: "/p" },
    });
  });

  it("refuses a relative custom folder before a relative HOME", () => {
    expect(piChildEnv({ HOME: "rel/h", TASKER_PI_CODING_AGENT_DIR: "rel/p" })).toEqual({
      reason: "TASKER_PI_CODING_AGENT_DIR must be an absolute path, got rel/p",
    });
  });

  it("uses an absolute HOME when the custom folder is unset", () => {
    expect(piChildEnv({ HOME: "/h" })).toEqual({
      env: { HOME: "/h", PI_CODING_AGENT_DIR: "/h/.pi/agent" },
    });
  });

  it("reports a missing HOME when it is blank", () => {
    expect(piChildEnv({ HOME: " " })).toEqual({
      reason: "tasker cannot find the agent folder of pi, because HOME is not set",
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
