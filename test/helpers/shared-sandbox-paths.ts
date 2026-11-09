import { resolve } from "node:path";

export interface SharedSandboxPaths {
  childTempRoot(env: NodeJS.ProcessEnv): string;
  herdrPath(env: NodeJS.ProcessEnv): string | undefined;
  runtimePath(env: NodeJS.ProcessEnv): string | undefined;
  DOCKER_SOCKET_PATH: string;
}

export async function sharedSandboxPaths(): Promise<SharedSandboxPaths> {
  const path = resolve(process.cwd(), "src/assistant/shared-sandbox-paths.js");
  return (await import(/* @vite-ignore */ path)) as SharedSandboxPaths;
}
