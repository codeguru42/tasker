import { homedir as osHomedir } from "node:os";
import { readTextFile } from "../read-text-file.js";
import { resolveConfigPath } from "./path.js";
import { parseConfig, type Config } from "./schema.js";

function readConfigText(path: string): string {
  const file = readTextFile(path);
  if (file.text !== undefined) return file.text;
  if (file.missing) throw new Error(`config file not found: ${path}`, { cause: file.cause });
  throw new Error(`cannot read config file: ${path} (${file.error})`, { cause: file.cause });
}

// The configuration in text, the text of the file at path. path is only for the error message.
export function parseConfigText(
  text: string,
  path: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = osHomedir(),
): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new Error(`config file is not valid JSON: ${path}`, { cause });
  }
  return parseConfig(raw, env, homedir);
}

// The path of the configuration file, its text and the configuration in it.
export function loadConfigFile(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = osHomedir(),
): { path: string; text: string; config: Config } {
  const path = resolveConfigPath(env, homedir);
  const text = readConfigText(path);
  return { path, text, config: parseConfigText(text, path, env, homedir) };
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = osHomedir(),
): Config {
  return loadConfigFile(env, homedir).config;
}
