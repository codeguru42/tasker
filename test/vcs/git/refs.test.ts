import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRevisionInput,
  isFullRevision,
  refExists,
  refRevision,
  resolveRevision,
} from "../../../src/vcs/git/refs.js";
import { type GitOrigin, makeGitClone, makeGitOrigin } from "../../helpers.js";

describe("refs", () => {
  let origin: GitOrigin;
  let env: NodeJS.ProcessEnv;
  let clone: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    env = origin.env;
    clone = await makeGitClone(origin);
  });

  afterEach(() => {
    origin.remove();
  });

  describe("isFullRevision", () => {
    it("accepts a 40 character lower-case hex text", () => {
      expect(isFullRevision("a".repeat(40))).toBe(true);
    });

    it.each(["a".repeat(39), "A".repeat(40), "main", "-x"])("refuses %j", (value) => {
      expect(isFullRevision(value)).toBe(false);
    });
  });

  describe("refExists", () => {
    it("is true for an existing full ref", async () => {
      expect(await refExists({ clone, env, ref: "refs/remotes/origin/main" })).toBe(true);
    });

    it.each(["refs/heads/missing", "refs/remotes/origin/main^{tree}", "refs/remotes/origin/main~1"])(
      "is false for %j",
      async (ref) => {
        expect(await refExists({ clone, env, ref })).toBe(false);
      },
    );
  });

  describe("refRevision", () => {
    it("gives the SHA of the ref", async () => {
      expect(await refRevision({ clone, env, ref: "refs/remotes/origin/main" })).toBe(
        await origin.branchHead("main"),
      );
    });

    it("gives undefined for a missing ref", async () => {
      expect(await refRevision({ clone, env, ref: "refs/heads/missing" })).toBeUndefined();
    });
  });

  describe("assertRevisionInput", () => {
    it.each(["main", "-x", "HEAD", "", "a..b"])("refuses %j", (value) => {
      expect(() => assertRevisionInput(value)).toThrow(
        `not a full revision or ref: ${JSON.stringify(value)}`,
      );
    });

    it.each(["a".repeat(40), "refs/x"])("accepts %j", (value) => {
      expect(() => assertRevisionInput(value)).not.toThrow();
    });
  });

  describe("resolveRevision", () => {
    it("keeps a full revision as it is", async () => {
      const value = "1".repeat(40);
      expect(await resolveRevision({ clone, env, value })).toBe(value);
    });

    it("gives the SHA of a ref", async () => {
      expect(await resolveRevision({ clone, env, value: "refs/remotes/origin/main" })).toBe(
        await origin.branchHead("main"),
      );
    });

    it("throws for a missing ref", async () => {
      await expect(
        resolveRevision({ clone, env, value: "refs/heads/missing" }),
      ).rejects.toThrow("cannot resolve the revision: refs/heads/missing");
    });

    it("throws for another text", async () => {
      await expect(resolveRevision({ clone, env, value: "main" })).rejects.toThrow(
        'not a full revision or ref: "main"',
      );
    });
  });
});
