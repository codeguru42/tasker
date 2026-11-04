import { describe, expect, it } from "vitest";
import { piAgentDir as fromPiAgentDir } from "../../src/assistant/config-folders.js";

function piAgentDir(env: NodeJS.ProcessEnv) {
  return fromPiAgentDir(env);
}

describe("piAgentDir", () => {
  it.each([
    ["the default under HOME", { HOME: "/home/user" }, "/home/user/.pi/agent"],
    ["no folder and no HOME", {}, undefined],
    ["blank folder and no HOME", { PI_CODING_AGENT_DIR: " " }, undefined],
    ["blank HOME", { HOME: " " }, undefined],
    ["tilde with no HOME", { PI_CODING_AGENT_DIR: "~" }, undefined],
    ["tilde with HOME", { HOME: "/home/user", PI_CODING_AGENT_DIR: "~" }, "/home/user"],
    ["tilde path with HOME", { HOME: "/home/user", PI_CODING_AGENT_DIR: "~/agent" }, "/home/user/agent"],
    ["tilde user path", { PI_CODING_AGENT_DIR: "~user/x" }, "~user/x"],
    ["file URL", { PI_CODING_AGENT_DIR: "file:///abs/x" }, "/abs/x"],
    ["file URL with host", { PI_CODING_AGENT_DIR: "file://host/x" }, "file://host/x"],
    ["relative folder", { PI_CODING_AGENT_DIR: "relative/x" }, "relative/x"],
    ["folder with surrounding spaces", { PI_CODING_AGENT_DIR: " /abs/x " }, " /abs/x "],
    ["custom folder", { PI_CODING_AGENT_DIR: "/custom/pi" }, "/custom/pi"],
  ] as const)("uses %s", (_name, env, expected) => {
    expect(piAgentDir(env)).toBe(expected);
  });
});
