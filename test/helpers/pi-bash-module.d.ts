declare module "@earendil-works/pi-coding-agent" {
  export const definitionCalls: { cwd: string; options: Record<string, unknown> }[];
  export function createBashToolDefinition(
    cwd: string,
    options: {
      operations: {
        exec(command: string, cwd: string, options: { onData(data: Buffer): void; timeout?: number }): Promise<unknown>;
      };
      [key: string]: unknown;
    },
  ): {
    name: string;
    executionMode: string;
    sourceInfo: { path: string; source: string };
    execute(input: unknown, context: { cwd?: unknown }): Promise<unknown>;
  };
}
