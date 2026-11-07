import { describe, expect, it } from "vitest";
import { piAgentDir as fromPiAgentDir, piAgentDirs as fromPiAgentDirs } from "../../src/assistant/config-folders.js";

function piAgentDir(env: NodeJS.ProcessEnv) {
  return fromPiAgentDir(env);
}

function piAgentDirs(env: NodeJS.ProcessEnv) {
  return fromPiAgentDirs(env);
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

  it("ignores PI_CODING_AGENT_DIR", () => {
    expect(piAgentDir({ HOME: "/h", PI_CODING_AGENT_DIR: "/u" })).toBe("/h/.pi/agent");
  });
});

describe("piAgentDirs", () => {
  it.each([
    ["defaults to HOME", { HOME: "/h" }, ["/h/.pi/agent"]],
    ["returns no folders without HOME", {}, []],
    ["uses PI_CODING_AGENT_DIR before HOME", { HOME: "/h", PI_CODING_AGENT_DIR: "/u" }, ["/u", "/h/.pi/agent"]],
    ["expands a tilde path", { HOME: "/h", PI_CODING_AGENT_DIR: "~/u" }, ["/h/u", "/h/.pi/agent"]],
    ["converts a file URL", { HOME: "/h", PI_CODING_AGENT_DIR: "file:///u" }, ["/u", "/h/.pi/agent"]],
    ["keeps a relative path", { HOME: "/h", PI_CODING_AGENT_DIR: "rel/u" }, ["rel/u", "/h/.pi/agent"]],
    [
      "keeps an invalid file URL",
      { HOME: "/h", PI_CODING_AGENT_DIR: "file://host/u" },
      ["file://host/u", "/h/.pi/agent"],
    ],
    ["ignores a blank value", { HOME: "/h", PI_CODING_AGENT_DIR: " " }, ["/h/.pi/agent"]],
    ["keeps duplicate folders", { HOME: "/h", PI_CODING_AGENT_DIR: "/h/.pi/agent" }, ["/h/.pi/agent", "/h/.pi/agent"]],
    ["puts Tasker first", { HOME: "/h", TASKER_PI_CODING_AGENT_DIR: "/p" }, ["/p", "/h/.pi/agent"]],
    [
      "keeps all three sources",
      { HOME: "/h", TASKER_PI_CODING_AGENT_DIR: "/p", PI_CODING_AGENT_DIR: "/u" },
      ["/p", "/u", "/h/.pi/agent"],
    ],
    [
      "keeps duplicates from sources",
      { HOME: "/h", TASKER_PI_CODING_AGENT_DIR: "/p", PI_CODING_AGENT_DIR: "/p" },
      ["/p", "/p", "/h/.pi/agent"],
    ],
    [
      "keeps relative Tasker paths",
      { HOME: "/h", TASKER_PI_CODING_AGENT_DIR: "rel/p", PI_CODING_AGENT_DIR: "/u" },
      ["rel/p", "/u", "/h/.pi/agent"],
    ],
    ["keeps a relative HOME path", { HOME: "rel/h" }, ["rel/h/.pi/agent"]],
    ["returns no tilde folders without HOME", { PI_CODING_AGENT_DIR: "~/u" }, []],
    ["ignores a blank HOME", { HOME: " ", PI_CODING_AGENT_DIR: "/u" }, ["/u"]],
  ] as const)("%s", (_name, env, expected) => {
    expect(piAgentDirs(env)).toEqual(expected);
  });
});
