import { describe, expect, it } from "vitest";
import { FAKE_BASIC_AUTH, FAKE_EMAIL, FAKE_TOKEN, expectNoFakeSecret, withFakeToken } from "./fake-credentials.js";

describe("fake credentials", () => {
  it("gives the basic auth value of the fake email and the fake token", () => {
    expect(FAKE_BASIC_AUTH).toBe("Basic dXNlckBleGFtcGxlLmNvbTp0ZXN0LXRva2Vu");
  });

  it("withFakeToken adds the fake token and keeps the input as it is", () => {
    const env = { PATH: "/bin" };

    expect(withFakeToken(env)).toEqual({ PATH: "/bin", TASKER_JIRA_TOKEN: FAKE_TOKEN });
    expect(env).toEqual({ PATH: "/bin" });
  });

  it("expectNoFakeSecret passes for text with no secret", () => {
    expect(() => expectNoFakeSecret("no secret here")).not.toThrow();
  });

  it("expectNoFakeSecret throws for text with the fake token", () => {
    expect(() => expectNoFakeSecret(`a ${FAKE_TOKEN} b`)).toThrow();
  });

  it("expectNoFakeSecret throws for text with the fake email", () => {
    expect(() => expectNoFakeSecret(`a ${FAKE_EMAIL} b`)).toThrow();
  });
});
