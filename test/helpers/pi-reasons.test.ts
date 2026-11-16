import { describe, expect, it } from "vitest";
import { relativeSessionFolderReason } from "./pi-reasons.js";

describe("relativeSessionFolderReason", () => {
  it("gives the reason of a relative session folder", () => {
    expect(relativeSessionFolderReason("rel/s")).toBe(
      "TASKER_PI_CODING_AGENT_SESSION_DIR must be an absolute path, got rel/s",
    );
  });
});
