/* eslint @typescript-eslint/triple-slash-reference: off */
/// <reference path="./pi-bash-module.d.ts" />
import { describe, expect, it, vi } from "vitest";
import { createBashToolDefinition, definitionCalls } from "@earendil-works/pi-coding-agent";

describe("the aliased pi Bash module", () => {
  it("calls the supplied operations from the fake Bash definition", async () => {
    definitionCalls.length = 0;
    const exec = vi.fn(async (command: string, cwd: string) => ({ command, cwd }));
    const definition = createBashToolDefinition("/default", { operations: { exec } });

    const result = await definition.execute({ command: "git status" }, { cwd: "/work/tree" });

    expect(result).toEqual({ command: "git status", cwd: "/work/tree" });
    expect(exec).toHaveBeenCalledWith(
      "git status",
      "/work/tree",
      expect.objectContaining({ onData: expect.any(Function), env: expect.any(Object) }),
    );
    expect(definition.name).toBe("bash");
  });
});
