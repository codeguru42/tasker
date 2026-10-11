import { readFileSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { resolveConfigPath } from "./path.js";
import { parseConfig, type Config } from "./schema.js";

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = osHomedir(),
): Config {
  const path = resolveConfigPath(env, homedir);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`config file not found: ${path}`, { cause });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error(`config file is not valid JSON: ${path}`, { cause });
  }
  return parseConfig(raw, env, homedir);
}
