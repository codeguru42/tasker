declare module "@earendil-works/pi-coding-agent" {
  export interface BashOperations {
    exec(
      command: string,
      cwd: string,
      options: {
        onData(data: Buffer): void;
        signal?: AbortSignal;
        timeout?: number;
        env?: NodeJS.ProcessEnv;
      },
    ): Promise<{ exitCode: number | null }>;
  }

  export interface BashToolDefinition {
    name: string;
    [key: string]: unknown;
  }

  export function createBashToolDefinition(cwd: string, options: { operations: BashOperations }): BashToolDefinition;
}
