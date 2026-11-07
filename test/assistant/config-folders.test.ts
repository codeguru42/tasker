import { describe, expect, it } from "vitest";
import { piAgentDir as fromPiAgentDir } from "../../src/assistant/config-folders.js";

function piAgentDir(env: NodeJS.ProcessEnv) {
  return fromPiAgentDir(env);
}

describe("piAgentDir", () => {
  it.each([
    ["the default under HOME", { HOME: "/home/user" }, "/home/user/.pi/agent"],
    ["no folder and no HOME", {}, undefined],
    ["blank folder and no HOME", { TASKER_PI_CODING_AGENT_DIR: " " }, undefined],
    ["blank HOME", { HOME: " " }, undefined],
    ["tilde path with no HOME", { TASKER_PI_CODING_AGENT_DIR: "~/agent" }, undefined],
    ["tilde path with blank HOME", { HOME: " ", TASKER_PI_CODING_AGENT_DIR: "~/agent" }, undefined],
    ["tilde with blank HOME", { HOME: " ", TASKER_PI_CODING_AGENT_DIR: "~" }, undefined],
    ["tilde with no HOME", { TASKER_PI_CODING_AGENT_DIR: "~" }, undefined],
    ["tilde with HOME", { HOME: "/home/user", TASKER_PI_CODING_AGENT_DIR: "~" }, "/home/user"],
    ["tilde path with HOME", { HOME: "/home/user", TASKER_PI_CODING_AGENT_DIR: "~/agent" }, "/home/user/agent"],
    ["tilde user path", { TASKER_PI_CODING_AGENT_DIR: "~user/x" }, "~user/x"],
    ["file URL", { TASKER_PI_CODING_AGENT_DIR: "file:///abs/x" }, "/abs/x"],
    ["file URL with host", { TASKER_PI_CODING_AGENT_DIR: "file://host/x" }, "file://host/x"],
    ["relative folder", { TASKER_PI_CODING_AGENT_DIR: "relative/x" }, "relative/x"],
    ["folder with surrounding spaces", { TASKER_PI_CODING_AGENT_DIR: " /abs/x " }, " /abs/x "],
    ["custom folder", { TASKER_PI_CODING_AGENT_DIR: "/custom/pi" }, "/custom/pi"],
  ] as const)("uses %s", (_name, env, expected) => {
    expect(piAgentDir(env)).toBe(expected);
  });
});
