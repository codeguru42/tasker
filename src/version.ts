import { readFileSync } from "node:fs";
import { packagePath } from "./package-path.js";

export function readVersion(): string {
  const text = readFileSync(packagePath("package.json"), "utf8");
  return (JSON.parse(text) as { version: string }).version;
}
