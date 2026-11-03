import { expect } from "vitest";

// The fake Jira credentials of the tests. No test uses a real token or a real email.
export const FAKE_TOKEN = "test-token";
export const FAKE_EMAIL = "user@example.com";
export const FAKE_BASIC_AUTH = `Basic ${Buffer.from(`${FAKE_EMAIL}:${FAKE_TOKEN}`).toString("base64")}`;

// Gives a copy of the env with the fake token. The input env stays as it is.
export function withFakeToken(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, TASKER_JIRA_TOKEN: FAKE_TOKEN };
}

export function expectNoFakeSecret(text: string): void {
  expect(text).not.toContain(FAKE_TOKEN);
  expect(text).not.toContain(FAKE_EMAIL);
}
