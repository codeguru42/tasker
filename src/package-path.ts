import { fileURLToPath } from "node:url";

// This file sits directly under src/ and dist/, so ".." is the package root.
export function packagePath(name: string): string {
  return fileURLToPath(new URL(`../${name}`, import.meta.url));
}
