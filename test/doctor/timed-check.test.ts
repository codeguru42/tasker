import { describe, expect, it } from "vitest";
import { DeadlineError, timedCheck } from "../../src/doctor/timed-check.js";

const spec = { name: "demo", required: true, timeoutMs: 100 };

describe("timedCheck", () => {
  it("keeps the name, required and timeoutMs", () => {
    const check = timedCheck(spec, async () => ({ status: "ok", detail: "fine" }));
    expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual(spec);
  });

  it("passes a result as it is", async () => {
    const result = { status: "warn" as const, detail: "d", remediation: "r" };
    const check = timedCheck(spec, async () => result);
    expect(await check.run({})).toEqual(result);
  });

  it("gives the message of a thrown Error", async () => {
    const check = timedCheck(spec, async () => {
      throw new Error("x");
    });
    expect(await check.run({})).toEqual({ status: "error", detail: "x" });
  });

  it("gives a thrown string as the detail", async () => {
    const check = timedCheck(spec, async () => {
      // The test makes sure that a value that is not an Error gives its text as the detail.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "plain text";
    });
    expect(await check.run({})).toEqual({ status: "error", detail: "plain text" });
  });

  it("gives the timeout result when the body waits past the limit", async () => {
    const check = timedCheck(
      spec,
      (_env, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    expect(await check.run({})).toEqual({
      status: "error",
      detail: "the check did not finish in 100 ms",
    });
  });

  it("gives the timeout result for a thrown DeadlineError", async () => {
    const check = timedCheck(spec, async () => {
      throw new DeadlineError("late");
    });
    expect(await check.run({})).toEqual({
      status: "error",
      detail: "the check did not finish in 100 ms",
    });
  });

  it("gives the timeout result for an ok result after the abort", async () => {
    const check = timedCheck(spec, async (_env, { signal }) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(signal.aborted).toBe(true);
      return { status: "ok", detail: "late" };
    });
    expect(await check.run({})).toEqual({
      status: "error",
      detail: "the check did not finish in 100 ms",
    });
  });
});
