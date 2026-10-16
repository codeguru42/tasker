import { describe, expect, it } from "vitest";
import { resolveConfigPath } from "../../src/config/path.js";

describe("resolveConfigPath", () => {
  it("uses TASKER_CONFIG first, even when XDG_CONFIG_HOME is set", () => {
    const env = { TASKER_CONFIG: "/x/c.json", XDG_CONFIG_HOME: "/xdg" };
    expect(resolveConfigPath(env, "/home/me")).toBe("/x/c.json");
  });

  it("uses XDG_CONFIG_HOME when TASKER_CONFIG is not set", () => {
    expect(resolveConfigPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/me")).toBe("/xdg/tasker/config.json");
  });

  it("falls back to the XDG default under the home directory", () => {
    expect(resolveConfigPath({}, "/home/me")).toBe("/home/me/.config/tasker/config.json");
  });

  it.each(["", "  "])("treats TASKER_CONFIG=%j as not set", (blank) => {
    const env = { TASKER_CONFIG: blank, XDG_CONFIG_HOME: "/xdg" };
    expect(resolveConfigPath(env, "/home/me")).toBe("/xdg/tasker/config.json");
  });
});
