declare module "@earendil-works/pi-coding-agent" {
  export interface BashOperations {
    exec(
      command: string,
      cwd: string,
      options: {
        onData(data: string): void;
        signal?: AbortSignal;
        timeout?: number;
        env?: NodeJS.ProcessEnv;
      },
    ): Promise<number>;
  }

  export interface BashToolDefinition {
    name: string;
    [key: string]: unknown;
  }

  export function createBashToolDefinition(cwd: string, options: { operations: BashOperations }): BashToolDefinition;
}
