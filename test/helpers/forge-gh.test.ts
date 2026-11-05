import { describe, expect, it } from "vitest";
import { runFakeGh } from "./fake-gh.js";
import { forgeGh } from "./forge-gh.js";
import { useTempDir } from "./temp.js";

describe("the forge gh helper", () => {
  it("records environment values and whether the token matches without saving the token", () => {
    const dir = useTempDir("tasker-forge-gh-helper-");
    const token = "synthetic-token-value";
    const fake = forgeGh(dir, token, [{ args: ["repo", "view"], stdout: "ok" }], ["TASKER_HOME", "NO_COLOR"]);
    const env = { ...fake.env, TASKER_HOME: "/home/tester", NO_COLOR: "1", GH_TOKEN: token };

    expect(runFakeGh(env, ["repo", "view"])).toMatchObject({ status: 0, stdout: "ok" });
    expect(fake.calls()).toEqual([
      {
        args: ["repo", "view"],
        tokenMatches: true,
        cwd: process.cwd(),
        env: { TASKER_HOME: "/home/tester", NO_COLOR: "1" },
      },
    ]);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
  });
});
