import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useProcessEnv, useTempDir, useTempHome } from "./temp.js";

describe("useTempDir", () => {
  let saved = "";

  it("makes a folder that exists", () => {
    saved = useTempDir("tasker-use-temp-");

    expect(saved).not.toBe("");
    expect(existsSync(saved)).toBe(true);
  });

  it("removes the folder after the test", () => {
    expect(saved).not.toBe("");
    expect(existsSync(saved)).toBe(false);
  });
});

describe("useProcessEnv", () => {
  it("sets a name", () => {
    useProcessEnv({ TASKER_HELPER_PROBE: "x" });

    expect(process.env.TASKER_HELPER_PROBE).toBe("x");
  });

  it("removes a name when the value is undefined", () => {
    useProcessEnv({ TASKER_HELPER_PROBE: "x" });
    useProcessEnv({ TASKER_HELPER_PROBE: undefined });

    expect(process.env.TASKER_HELPER_PROBE).toBeUndefined();
  });

  it("restores process.env after the test", () => {
    expect(process.env.TASKER_HELPER_PROBE).toBeUndefined();
  });
});

describe("useTempHome", () => {
  it("gives an existing folder as HOME and <HOME>/config as XDG_CONFIG_HOME", () => {
    const env = useTempHome();
    expect(existsSync(env.HOME)).toBe(true);
    expect(env.XDG_CONFIG_HOME).toBe(join(env.HOME, "config"));
  });
});
