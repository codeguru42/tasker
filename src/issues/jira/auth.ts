import type { AuthStatus } from "../provider.js";

// Stub: the green commit replaces it.
export async function authStatus(_env: NodeJS.ProcessEnv, options: { signal?: AbortSignal } = {}): Promise<AuthStatus> {
  await Promise.resolve(options);
  throw new Error("not implemented");
}
