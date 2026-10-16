import { describe, expect, it } from "vitest";
import type { RemoteTip } from "../../src/vcs/provider.js";
import { tipMoved } from "../../src/vcs/remote-tip.js";

describe("tipMoved", () => {
  const a: RemoteTip = { state: "present", revision: "a".repeat(40) };
  const b: RemoteTip = { state: "present", revision: "b".repeat(40) };
  const absent: RemoteTip = { state: "absent" };
  const moved = (from: string, to: string): string => `the tip of the branch on the remote moved from ${from} to ${to}`;

  it("gives undefined when the tip did not move", () => {
    expect(tipMoved(a, { ...a })).toBeUndefined();
    expect(tipMoved(absent, { state: "absent" })).toBeUndefined();
  });

  it("names both revisions when the tip moved", () => {
    expect(tipMoved(a, b)).toBe(moved("a".repeat(40), "b".repeat(40)));
  });

  it("writes absent for a tip that does not exist", () => {
    expect(tipMoved(absent, a)).toBe(moved("absent", "a".repeat(40)));
    expect(tipMoved(a, absent)).toBe(moved("a".repeat(40), "absent"));
  });
});
