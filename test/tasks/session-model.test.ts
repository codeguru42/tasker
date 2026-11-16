import { describe, expect, it } from "vitest";
import { assertSessionModel } from "../../src/tasks/session-model.js";
import type { StoredSession } from "../../src/store/store.js";
import { failureOf } from "../helpers/errors.js";
import { TEST_SESSION_ID } from "../helpers/fake-claude.js";
import { piAuthArgs, useFakePi } from "../helpers/fake-pi.js";
import { REPORTED_PI_MODEL, ROUTER_PI_MODEL } from "../helpers/pi-provider.js";

const NAME = "the plan session of codeguru42/tasker#5";

const sessionWith = (reportedModel?: string): StoredSession => ({
  sessionId: TEST_SESSION_ID,
  repoKey: "tasker",
  provider: "pi",
  model: ROUTER_PI_MODEL,
  effort: "high",
  trustedExtensions: [],
  ...(reportedModel === undefined ? {} : { reportedModel }),
});

describe("assertSessionModel with a reported model of pi", () => {
  it("refuses a reported model that ends in a thinking level", async () => {
    const fake = useFakePi([]);
    const error = await failureOf(
      assertSessionModel(sessionWith("openrouter/x:high"), { ...fake.env, HOME: "/home/user" }, NAME),
      Error,
    );

    expect(error.message).toBe(
      `${NAME} runs on openrouter/x:high, and pi refuses it: ends in the pi thinking level :high: openrouter/x:high`,
    );
  });

  it("refuses a reported model of an upstream that pi does not know", async () => {
    const fake = useFakePi([
      {
        args: piAuthArgs("anthropic"),
        exitCode: 1,
        stdout: JSON.stringify({ status: "not_ready", provider: "anthropic", reason: "provider_not_found" }),
      },
    ]);
    const error = await failureOf(
      assertSessionModel(sessionWith("anthropic/claude-fable-5"), { ...fake.env, HOME: "/home/user" }, NAME),
      Error,
    );

    expect(error.message).toBe(
      `${NAME} runs on anthropic/claude-fable-5, and pi refuses it: pi does not know the provider anthropic`,
    );
  });

  it("accepts a reported model of another upstream with credentials", async () => {
    const fake = useFakePi([
      {
        args: piAuthArgs("anthropic"),
        stdout: JSON.stringify({ status: "ready", provider: "anthropic", authType: "oauth" }),
      },
    ]);

    await assertSessionModel(sessionWith("anthropic/claude-fable-5"), { ...fake.env, HOME: "/home/user" }, NAME);

    expect(fake.calls().map((call) => call.args)).toEqual([piAuthArgs("anthropic")]);
  });

  it("runs no auth check for a reported model of the same upstream", async () => {
    const fake = useFakePi([]);

    await assertSessionModel(sessionWith(REPORTED_PI_MODEL), { ...fake.env, HOME: "/home/user" }, NAME);

    expect(fake.calls()).toEqual([]);
  });

  it("runs no auth check when pi reported no model", async () => {
    const fake = useFakePi([]);

    await assertSessionModel(sessionWith(), { ...fake.env, HOME: "/home/user" }, NAME);

    expect(fake.calls()).toEqual([]);
  });
});
