import { describe, expect, it } from "vitest";
import type { Check, CheckResult } from "../../src/doctor/check.js";
import { formatResult, runChecks } from "../../src/doctor/run-checks.js";
import { timedCheck } from "../../src/doctor/timed-check.js";

function makeCheck(name: string, required: boolean, result: CheckResult): Check {
  return timedCheck({ name, required, timeoutMs: 1000 }, async () => result);
}

async function run(checks: Check[]): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const code = await runChecks(checks, {}, (text) => chunks.push(text));
  return { code, out: chunks.join("") };
}

describe("runChecks", () => {
  it("writes the output of each check before the next check starts", async () => {
    const chunks: string[] = [];
    let seenBySecond = "";
    const first = makeCheck("first", true, { status: "ok", detail: "one" });
    const second = timedCheck({ name: "second", required: true, timeoutMs: 1000 }, async () => {
      seenBySecond = chunks.join("");
      return { status: "ok", detail: "two" };
    });

    await runChecks([first, second], {}, (text) => chunks.push(text));

    expect(seenBySecond).toBe("ok    first: one\n");
    expect(chunks.join("")).toBe("ok    first: one\nok    second: two\n");
  });

  it("gives 1 when a required check gives error, and still runs the next check", async () => {
    const { code, out } = await run([
      makeCheck("bad", true, { status: "error", detail: "broken" }),
      makeCheck("next", false, { status: "ok", detail: "fine" }),
    ]);

    expect(code).toBe(1);
    expect(out).toBe("error bad: broken\nok    next: fine\n");
  });

  it("gives 0 when a check that is not required gives error", async () => {
    const { code } = await run([makeCheck("soft", false, { status: "error", detail: "broken" })]);

    expect(code).toBe(0);
  });

  it("gives 0 when the results are only warn", async () => {
    const { code } = await run([
      makeCheck("a", true, { status: "warn", detail: "careful" }),
      makeCheck("b", false, { status: "warn", detail: "careful" }),
    ]);

    expect(code).toBe(0);
  });

  it("gives the message of a body that throws", async () => {
    const check = timedCheck({ name: "boom-check", required: false, timeoutMs: 1000 }, async () => {
      throw new Error("boom");
    });

    const { out } = await run([check]);

    expect(out).toBe("error boom-check: boom\n");
  });

  it("stops a check at its timeout, gives 1 and runs the next check", async () => {
    const slow = timedCheck(
      { name: "slow", required: true, timeoutMs: 50 },
      (_env, { signal }) =>
        new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    );
    const start = Date.now();

    const { code, out } = await run([slow, makeCheck("next", false, { status: "ok", detail: "fine" })]);

    expect(Date.now() - start).toBeLessThan(1000);
    expect(code).toBe(1);
    expect(out).toBe("error slow: the check did not finish in 50 ms\nok    next: fine\n");
  });
});

describe("formatResult", () => {
  it("writes one line for a one-line detail", () => {
    expect(formatResult({ name: "gh version" }, { status: "ok", detail: "gh 2.101.0" })).toBe(
      "ok    gh version: gh 2.101.0\n",
    );
  });

  it("pads a warn status to the same column", () => {
    expect(formatResult({ name: "free space" }, { status: "warn", detail: "low" })).toBe(
      "warn  free space: low\n",
    );
  });

  it("puts the other detail lines and the remediation lines after the first line, with an indent", () => {
    const text = formatResult(
      { name: "git version" },
      { status: "error", detail: "first\nsecond", remediation: "Install git." },
    );

    expect(text).toBe("error git version: first\n      second\n      Install git.\n");
  });

  it("writes only the status and the name for an empty detail", () => {
    expect(formatResult({ name: "name" }, { status: "ok", detail: "" })).toBe("ok    name\n");
  });
});
