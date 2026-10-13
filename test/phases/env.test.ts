import { describe, expect, it } from "vitest";
import { ALLOWED_ENV_NAMES } from "../../src/config/allowed-env-names.js";
import { phaseEnv } from "../../src/phases/env.js";

interface Row {
  name: string;
  env: NodeJS.ProcessEnv;
  extraNames: string[];
}

const rows: Row[] = [
  { name: "an allowed name", env: { HOME: "/home/me" }, extraNames: [] },
  { name: "a listed name", env: { NPM_TOKEN: "npm-secret" }, extraNames: ["NPM_TOKEN"] },
  { name: "a listed name that is not set", env: { HOME: "/home/me" }, extraNames: ["NPM_TOKEN"] },
  {
    name: "ANTHROPIC_API_KEY listed and set",
    env: { ANTHROPIC_API_KEY: "key", HOME: "/home/me" },
    extraNames: ["ANTHROPIC_API_KEY"],
  },
  {
    name: "a TASKER_ name listed and set",
    env: { TASKER_CONFIG: "/etc/tasker.json", HOME: "/home/me" },
    extraNames: ["TASKER_CONFIG"],
  },
  { name: "an empty env", env: {}, extraNames: ["NPM_TOKEN"] },
  { name: "a name in both lists", env: { HOME: "/home/me" }, extraNames: ["HOME"] },
  {
    name: "ANTHROPIC_AUTH_TOKEN listed and set",
    env: { ANTHROPIC_AUTH_TOKEN: "token", HOME: "/home/me" },
    extraNames: ["ANTHROPIC_AUTH_TOKEN"],
  },
  {
    name: "ANTHROPIC_API_KEY set but not listed",
    env: { ANTHROPIC_API_KEY: "key", HOME: "/home/me" },
    extraNames: [],
  },
  {
    name: "TASKER_CONFIG set but not listed",
    env: { TASKER_CONFIG: "/etc/tasker.json", HOME: "/home/me" },
    extraNames: [],
  },
  { name: "an empty extraNames", env: { HOME: "/home/me", NPM_TOKEN: "npm-secret" }, extraNames: [] },
  { name: "a name set to an empty string", env: { NPM_TOKEN: "", HOME: "" }, extraNames: ["NPM_TOKEN"] },
  {
    name: "a name that is not allowed and not listed",
    env: { SECRET: "s", HOME: "/home/me" },
    extraNames: [],
  },
];

function isDropped(name: string): boolean {
  return name.startsWith("TASKER_") || name === "ANTHROPIC_API_KEY" || name === "ANTHROPIC_AUTH_TOKEN";
}

// The expected result, built without phaseEnv: each set name of the two lists, except a dropped name.
function expectedEnv(row: Row): NodeJS.ProcessEnv {
  const expected: NodeJS.ProcessEnv = {};
  for (const name of new Set([...ALLOWED_ENV_NAMES, ...row.extraNames])) {
    const value = row.env[name];
    if (value !== undefined && !isDropped(name)) expected[name] = value;
  }
  return expected;
}

// Each promise of the issue, one by one.
function expectPromises(result: NodeJS.ProcessEnv, row: Row): void {
  const listed = new Set([...ALLOWED_ENV_NAMES, ...row.extraNames]);
  for (const [name, value] of Object.entries(result)) {
    expect(listed.has(name), `${name} is in one of the two lists`).toBe(true);
    expect(row.env[name], `${name} is set in env`).toBeDefined();
    expect(value, `${name} has the value of env`).toBe(row.env[name]);
  }
  expect(result).not.toHaveProperty("ANTHROPIC_API_KEY");
  expect(result).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
  expect(Object.keys(result).filter((name) => name.startsWith("TASKER_"))).toEqual([]);
}

describe("phaseEnv", () => {
  it.each(rows)("phaseEnv for $name", (row) => {
    const result = phaseEnv(row.env, row.extraNames);

    expectPromises(result, row);
    expect(result).toEqual(expectedEnv(row));
  });

  it("does not change env", () => {
    const env = { HOME: "/home/me", NPM_TOKEN: "npm-secret", ANTHROPIC_API_KEY: "key", TASKER_CONFIG: "x" };
    const before = structuredClone(env);

    phaseEnv(env, ["NPM_TOKEN", "ANTHROPIC_API_KEY", "TASKER_CONFIG"]);

    expect(env).toEqual(before);
  });
});
