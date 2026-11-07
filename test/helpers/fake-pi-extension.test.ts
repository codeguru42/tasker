import { describe, expect, it } from "vitest";
import { useFakePiExtension } from "./fake-pi-extension.js";

interface TestTool {
  name: string;
  sourceInfo: { path: string; source: string };
  execute: (input: unknown, ctx: unknown) => unknown;
}

function fakeExtension(tools: TestTool[] = [], flags: Record<string, string> = {}) {
  return useFakePiExtension(tools, flags);
}

function on(fake: ReturnType<typeof fakeExtension>, event: string, handler: (event: unknown, ctx: unknown) => unknown) {
  fake.pi.on(event, handler);
}

function registerFlag(fake: ReturnType<typeof fakeExtension>, name: string) {
  fake.pi.registerFlag(name, `description for ${name}`);
}

function getFlag(fake: ReturnType<typeof fakeExtension>, name: string) {
  return fake.pi.getFlag(name);
}

function registerTool(fake: ReturnType<typeof fakeExtension>, tool: TestTool) {
  fake.pi.registerTool(tool);
}

async function dispatch(fake: ReturnType<typeof fakeExtension>, event: string, data: unknown) {
  return fake.dispatch(event, data, {});
}

function allTools(fake: ReturnType<typeof fakeExtension>) {
  return fake.pi.getAllTools();
}

function registeredFlags(fake: ReturnType<typeof fakeExtension>) {
  return fake.registeredFlags();
}

async function callTool(fake: ReturnType<typeof fakeExtension>, name: string, input: unknown) {
  return fake.callTool(name, input);
}

describe("useFakePiExtension", () => {
  it("registers and dispatches handlers", async () => {
    const fake = fakeExtension();
    const seen: unknown[] = [];
    on(fake, "before_agent_start", (event) => {
      seen.push(event);
      return "handled";
    });

    const results = await dispatch(fake, "before_agent_start", { prompt: "hello" });

    expect(seen).toEqual([{ prompt: "hello" }]);
    expect(results).toEqual(["handled"]);
  });

  it("registers flags and provides their configured values", () => {
    const fake = fakeExtension([], { "tasker-guard-limits": "/tmp/limits.json" });
    registerFlag(fake, "tasker-guard-limits");

    expect(registeredFlags(fake)).toEqual(["tasker-guard-limits"]);
    expect(getFlag(fake, "tasker-guard-limits")).toBe("/tmp/limits.json");
  });

  it("lists current tool sources", () => {
    const readTool = {
      name: "read",
      sourceInfo: { path: "builtin:read", source: "builtin" },
      execute: () => "read",
    };
    const fake = fakeExtension([readTool]);

    expect(allTools(fake)).toEqual([readTool]);
  });

  it("replaces a tool with the same name", () => {
    const builtIn = {
      name: "read",
      sourceInfo: { path: "builtin:read", source: "builtin" },
      execute: () => "built-in",
    };
    const replacement = {
      name: "read",
      sourceInfo: { path: "/tmp/extension.js", source: "cli" },
      execute: () => "extension",
    };
    const fake = fakeExtension([builtIn]);
    registerTool(fake, replacement);

    expect(allTools(fake)).toEqual([replacement]);
  });

  it("sends a nested tool call through tool_call handlers", async () => {
    const nestedCalls: string[] = [];
    const fake = fakeExtension([
      {
        name: "outer",
        sourceInfo: { path: "/tmp/outer.js", source: "cli" },
        execute: (_input, ctx) =>
          (ctx as { executeTool: (name: string, input: unknown) => unknown }).executeTool("inner", {}),
      },
      {
        name: "inner",
        sourceInfo: { path: "builtin:inner", source: "builtin" },
        execute: () => "nested result",
      },
    ]);
    on(fake, "tool_call", (event) => {
      nestedCalls.push((event as { toolName: string }).toolName);
    });

    const result = await callTool(fake, "outer", {});

    expect(result).toBe("nested result");
    expect(nestedCalls).toEqual(["outer", "inner"]);
  });
});
