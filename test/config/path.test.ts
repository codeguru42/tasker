import { describe, expect, it } from "vitest";
import { relativePathReason as fromRelativePathReason, resolveConfigPath } from "../../src/config/path.js";

function relativePathReason(name: string, value: string | undefined): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return fromRelativePathReason(name, value);
}

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

describe("relativePathReason", () => {
  it.each([undefined, "", "  ", "/abs/x"])("accepts unset, blank, or absolute value %j", (value) => {
    expect(relativePathReason("TASKER_PATH", value)).toBeUndefined();
  });

  it.each(["rel/x", "~/x", "file:///x"])("rejects relative value %s", (value) => {
    expect(relativePathReason("TASKER_PATH", value)).toBe(`TASKER_PATH must be an absolute path, got ${value}`);
  });
});
