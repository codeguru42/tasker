import { fileURLToPath } from "node:url";

// This file exists only under dist/.
const extensionPath = fileURLToPath(new URL("./guard-extension.js", import.meta.url));

export function guardStartArgs(limitsPath: string): string[] {
  return ["--no-mcp", "-e", extensionPath, "--tasker-guard-limits", limitsPath];
}
