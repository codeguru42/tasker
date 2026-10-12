import { mkdirSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGh, makeTempDir } from "../../helpers.js";

describe("gh doctor checks", () => {
  // The module loads again before each test, so that each test starts with an empty token cache.
  // Never import doctor.ts or run.ts at the top of this file: a second copy would have other error classes.
  let doctor: typeof import("../../../src/issues/github/doctor.js");
  let dir: string;

  beforeEach(async () => {
    dir = makeTempDir("tasker-gh-doctor-");
    vi.resetModules();
    doctor = await import("../../../src/issues/github/doctor.js");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("ghVersionCheck", () => {
    const versionArgs = ["--version"];
    const OLDER = (found: string) =>
      `gh ${found} is older than the minimum 2.40.0. Before 2.40.0, gh auth token has no --user flag.`;

    it("has the name, required and timeoutMs of the version check", () => {
      const check = doctor.ghVersionCheck();
      expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual({
        name: "gh version",
        required: true,
        timeoutMs: 5000,
      });
    });

    it.each([
      ["gh version 2.40.0", "ok", "gh 2.40.0 (minimum 2.40.0)"],
      ["gh version 2.101.0", "ok", "gh 2.101.0 (minimum 2.40.0)"],
      ["gh version 3.0.0", "ok", "gh 3.0.0 (minimum 2.40.0)"],
      ["gh version 2.40.0-rc.1", "ok", "gh 2.40.0-rc.1 (minimum 2.40.0)"],
      [
        "gh version 2.40.0 (2023-12-07)\r\nhttps://github.com/cli/cli/releases/tag/v2.40.0",
        "ok",
        "gh 2.40.0 (minimum 2.40.0)",
      ],
      ["gh version 2.39.2", "error", OLDER("2.39.2")],
      ["gh version 1.99.99", "error", OLDER("1.99.99")],
      ["gh version 2.39.99-pre", "error", OLDER("2.39.99-pre")],
      ["gh version 2.40", "error", "cannot read the gh version from: gh version 2.40"],
      ["gh version DEV", "error", "cannot read the gh version from: gh version DEV"],
      ["gh version v2.40.0", "error", "cannot read the gh version from: gh version v2.40.0"],
      ["", "error", "cannot read the gh version from: "],
    ])("reads %j as %s", async (stdout, status, detail) => {
      const fake = fakeGh(dir, {}, [{ args: versionArgs, stdout }]);
      const result = await doctor.ghVersionCheck().run(fake.env);
      expect(result.status).toBe(status);
      expect(result.detail).toBe(detail);
      expect(result.remediation).toBe(
        status === "error" && detail.includes("older")
          ? "Install gh 2.40.0 or newer."
          : undefined,
      );
      expect(fake.calls()).toEqual([{ args: versionArgs, ghToken: undefined, env: {} }]);
    });

    it("gives error and a remediation when gh is not installed", async () => {
      const empty = `${dir}/empty`;
      mkdirSync(empty);
      expect(await doctor.ghVersionCheck().run({ PATH: empty })).toEqual({
        status: "error",
        detail: "gh is not installed. tasker needs gh 2.40.0 or newer.",
        remediation: "Install gh 2.40.0 or newer.",
      });
    });

    it("gives the timeout result when gh is slow", async () => {
      const fake = fakeGh(dir, {}, [{ args: versionArgs, stdout: "x", delaySeconds: 5 }]);
      const start = Date.now();
      const result = await doctor.ghVersionCheck(200).run(fake.env);
      expect(result).toEqual({
        status: "error",
        detail: "the check did not finish in 200 ms",
      });
      expect(Date.now() - start).toBeLessThan(2000);
      expect(fake.calls()).toEqual([{ args: versionArgs, ghToken: undefined, env: {} }]);
    });

    it("makes no token call", async () => {
      const fake = fakeGh(dir, {}, [{ args: versionArgs, stdout: "gh version 2.101.0\n" }]);
      await doctor.ghVersionCheck().run(fake.env);
      expect(fake.calls().filter((call) => call.args[0] === "auth")).toEqual([]);
    });
  });
});
