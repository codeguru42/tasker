import type { PiSandboxLimits } from "../../src/assistant/pi/guard-limits.js";

// The sandbox limits of a pi execute start, with fixed defaults. A test overrides the fields that it needs.
export function piSandboxLimits(overrides: Partial<PiSandboxLimits> = {}): PiSandboxLimits {
  return {
    bwrap: "/usr/bin/bwrap",
    worktree: "/work",
    writePaths: [],
    tempFolder: "/start",
    hidePaths: [],
    ...overrides,
  };
}
