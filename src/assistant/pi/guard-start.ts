import { fileURLToPath } from "node:url";

// Keep the built extension path beside the compiled pi provider files.
const extensionPath = fileURLToPath(new URL("./guard-extension.js", import.meta.url)).replace(
  "/src/assistant/pi/",
  "/dist/assistant/pi/",
);

export function guardStartArgs(limitsPath: string): string[] {
  return ["--no-mcp", "-e", extensionPath, "--tasker-guard-limits", limitsPath];
}
