import { guardExtensionPath } from "../../src/assistant/pi/guard-start.js";

export interface PiBashExecOptions {
  onData(data: string): void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export interface PiBashOperations {
  exec(command: string, cwd: string, options: PiBashExecOptions): Promise<unknown>;
}

export interface PiBashDefinition {
  name: string;
  sourceInfo: { path: string; source: string };
  executionMode: "sequential";
  execute(input: unknown, context: { cwd?: unknown }): Promise<unknown>;
}

export const definitionCalls: { cwd: string; options: Record<string, unknown> }[] = [];

export function createBashToolDefinition(
  cwd: string,
  options: { operations: PiBashOperations } & Record<string, unknown>,
): PiBashDefinition {
  definitionCalls.push({ cwd, options });
  return {
    name: "bash",
    sourceInfo: { path: guardExtensionPath, source: "cli" },
    executionMode: "sequential",
    async execute(input, context) {
      const params = input as { command?: unknown };
      if (typeof params.command !== "string") throw new Error("command must be a string");
      const callCwd = typeof context.cwd === "string" ? context.cwd : cwd;
      return options.operations.exec(params.command, callCwd, {
        onData: () => undefined,
        env: process.env,
      });
    },
  };
}
