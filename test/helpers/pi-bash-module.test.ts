/* eslint @typescript-eslint/triple-slash-reference: off */
/// <reference path="./pi-bash-module.d.ts" />
import { describe, expect, it, vi } from "vitest";
import { createBashToolDefinition, definitionCalls } from "@earendil-works/pi-coding-agent";

describe("the aliased pi Bash module", () => {
  it("calls the supplied operations from the fake Bash definition", async () => {
    definitionCalls.length = 0;
    const exec = vi.fn(
      async (command: string, cwd: string, options: { onData(data: Buffer): void; timeout?: number }) => {
        options.onData(Buffer.from("hi"));
        return { exitCode: 0, command, cwd };
      },
    );
    const definition = createBashToolDefinition("/default", { operations: { exec } });

    const result = await definition.execute({ command: "git status" }, { cwd: "/work/tree" });

    expect(result).toBe(0);
    expect(exec).toHaveBeenCalledWith(
      "git status",
      "/work/tree",
      expect.objectContaining({ onData: expect.any(Function), env: expect.any(Object) }),
    );
    const callOptions = exec.mock.calls[0]?.[2];
    const onData = (data: unknown) => callOptions?.onData(data as Buffer);
    expect(() => onData("not a buffer")).toThrow("onData must receive a Buffer");
    callOptions?.onData(Buffer.from([0xc3]));
    callOptions?.onData(Buffer.from([0xa9]));
    expect(definition.name).toBe("bash");
  });
});
