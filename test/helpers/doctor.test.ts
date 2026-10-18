import { describe, expect, it } from "vitest";
import type { Check } from "../../src/doctor/check.js";
import { checkSummaries } from "./doctor.js";

describe("checkSummaries", () => {
  it("gives the name, the required flag and the time limit of each check, in order", () => {
    const run = async () => ({ status: "ok" as const, detail: "" });
    const checks: Check[] = [
      { name: "b check", required: false, timeoutMs: 20, run },
      { name: "a check", required: true, timeoutMs: 10, run },
    ];
    expect(checkSummaries(checks)).toEqual([
      { name: "b check", required: false, timeoutMs: 20 },
      { name: "a check", required: true, timeoutMs: 10 },
    ]);
  });
});
