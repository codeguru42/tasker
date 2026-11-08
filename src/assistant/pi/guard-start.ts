import { fileURLToPath } from "node:url";

// This file exists only under dist/.
export const guardExtensionPath = fileURLToPath(new URL("./guard-extension.js", import.meta.url));

export function guardStartArgs(limitsPath: string, guardFile = guardExtensionPath): string[] {
  return ["--no-mcp", "-e", guardFile, "--tasker-guard-limits", limitsPath];
}
