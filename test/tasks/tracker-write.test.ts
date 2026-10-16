import { describe, expect, it } from "vitest";
import type { RepoConfig } from "../../src/config/schema.js";
import { trackerTargets } from "../../src/tasks/tracker-write.js";

const ALL_KEYS = {
  inProgressLabel: "in progress",
  doneLabel: "done",
  inProgressStatus: "In Progress",
  doneStatus: "Done",
};

// Calls trackerTargets for a tracker of the provider with the keys. The cast gives a partial tracker.
function targetsOf(provider: "github" | "jira", keys: Record<string, string> = {}) {
  return trackerTargets({ provider, ...keys });
}

describe("trackerTargets", () => {
  it("gives the labels for github and ignores the status keys", () => {
    expect(targetsOf("github", ALL_KEYS)).toEqual({ inProgress: "in progress", done: "done" });
  });

  it("gives the statuses for jira and ignores the label keys", () => {
    expect(targetsOf("jira", ALL_KEYS)).toEqual({ inProgress: "In Progress", done: "Done" });
  });

  it("gives undefined for keys that are not set", () => {
    expect(targetsOf("github")).toEqual({ inProgress: undefined, done: undefined });
    expect(targetsOf("jira", { inProgressLabel: "x", doneLabel: "y" })).toEqual({
      inProgress: undefined,
      done: undefined,
    });
  });
});
