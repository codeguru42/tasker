import { isSet } from "../config/path.js";
import { CommandNotFoundError, type ChildResult } from "../process/run-child.js";
import { ProgramFileError } from "../process/resolve-program.js";
import { startFolderError } from "../process/start-folder.js";
import { GhProcessError, runGhProcess } from "./process.js";

export interface GhSession {
  run(args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<string>;
}

export function forgeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const forgeEnv = { ...env };
  forgeEnv.TASKER_PATH ??= forgeEnv.PATH;
  if (forgeEnv.TASKER_HOME === undefined && forgeEnv.TASKER_GH_CONFIG_DIR === undefined) {
    forgeEnv.TASKER_HOME = forgeEnv.HOME;
  }
  return forgeEnv;
}

const forbiddenCommands = new Set(["token", "login", "logout", "switch"]);
const forbiddenEnvironment = ["TASKER_GH_TOKEN", "TASKER_GH_HOST", "TASKER_GH_REPO"] as const;

interface GhSessionErrorFields {
  subcommand?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
}

class GhSessionError extends Error {
  readonly subcommand: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(message: string, fields: GhSessionErrorFields = {}, cause?: Error) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GhSessionError";
    this.subcommand = fields.subcommand ?? "";
    this.stdout = fields.stdout ?? "";
    this.stderr = fields.stderr ?? "";
    this.exitCode = fields.exitCode ?? null;
  }
}

class GhLoginError extends GhSessionError {
  constructor(account: string) {
    super(`gh has no login for the account ${account}: run \`gh auth login\` and log in as ${account}`);
    this.name = "GhLoginError";
  }
}

class GhInstallError extends GhSessionError {
  constructor(message: string, cause: Error) {
    super(`${message}. Install gh or set TASKER_GH_BIN to a runnable file.`, {}, cause);
    this.name = "GhInstallError";
  }
}

export function createGhSession(account: string): GhSession {
  if (!isSet(account)) throw new Error("a GitHub account is required");

  let token: string | undefined;
  let tokenRead: Promise<string> | undefined;

  return {
    run(args, { cwd, env }) {
      if (args.length === 0) return Promise.reject(new Error("a gh command is required"));
      const [command, subcommand] = args;
      if (command.startsWith("-")) return Promise.reject(new Error("the first gh argument must be a command"));
      if (command === "auth" && forbiddenCommands.has(subcommand ?? "")) {
        return Promise.reject(new Error(`gh auth ${subcommand} is managed outside the forge session`));
      }
      if ((command === "pr" && subcommand === "checkout") || (command === "repo" && subcommand === "sync")) {
        return Promise.reject(new Error(`gh ${command} ${subcommand} changes the local branch`));
      }
      if (
        command === "repo" &&
        subcommand === "create" &&
        ["--push", "--push=1", "--push=t", "--push=T", "--push=true", "--push=TRUE", "--push=True"].some((push) =>
          args.includes(push),
        )
      ) {
        return Promise.reject(new Error("gh repo create --push publishes a branch"));
      }

      for (const name of forbiddenEnvironment) {
        if (env[name] !== undefined) return Promise.reject(new Error(`${name} must not be supplied`));
      }
      if (!isSet(env.TASKER_PATH)) return Promise.reject(new Error("TASKER_PATH must be a nonblank path"));
      if (!isSet(env.TASKER_HOME) && !isSet(env.TASKER_GH_CONFIG_DIR)) {
        return Promise.reject(new Error("TASKER_HOME or TASKER_GH_CONFIG_DIR must be nonblank"));
      }
      const folderError = startFolderError(env.TASKER_GH_BIN ?? "gh", cwd);
      if (folderError !== undefined) return Promise.reject(new Error(folderError));

      const childEnv: NodeJS.ProcessEnv = {
        PATH: env.TASKER_PATH,
        ...(isSet(env.TASKER_HOME) ? { HOME: env.TASKER_HOME } : {}),
        ...(isSet(env.TASKER_GH_CONFIG_DIR) ? { GH_CONFIG_DIR: env.TASKER_GH_CONFIG_DIR } : {}),
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        NO_COLOR: "1",
      };
      const programEnv = { ...childEnv, TASKER_GH_BIN: env.TASKER_GH_BIN };
      return accountToken(childEnv, programEnv).then((accountTokenValue) =>
        runGhProcess(
          args,
          { ...childEnv, GH_TOKEN: accountTokenValue },
          { cwd, programEnv, token: accountTokenValue },
        ).then(
          (result) => redact(result.stdout, accountTokenValue),
          (error: unknown) => Promise.reject(repositoryError(error, accountTokenValue)),
        ),
      );
    },
  };

  function accountToken(childEnv: NodeJS.ProcessEnv, programEnv: NodeJS.ProcessEnv): Promise<string> {
    if (token !== undefined) return Promise.resolve(token);
    if (tokenRead !== undefined) return tokenRead;

    const read = readAccountToken(account, childEnv, programEnv);
    tokenRead = read;
    read.then(
      (value) => {
        token = value;
        tokenRead = undefined;
      },
      () => {
        tokenRead = undefined;
      },
    );
    return read;
  }
}

async function readAccountToken(
  account: string,
  childEnv: NodeJS.ProcessEnv,
  programEnv: NodeJS.ProcessEnv,
): Promise<string> {
  let result: ChildResult;
  try {
    result = await runGhProcess(["auth", "token", "--user", account], childEnv, { programEnv, dropStdout: true });
  } catch (error) {
    if (error instanceof GhProcessError) {
      if (error.exitCode === null) {
        throw new GhSessionError(error.message, { subcommand: error.subcommand, exitCode: null });
      }
      throw new GhLoginError(account);
    }
    if (error instanceof CommandNotFoundError || error instanceof ProgramFileError) {
      throw new GhInstallError(error.message, sanitizeError(error));
    }
    if (isAccessDenied(error)) {
      const cause = sanitizeError(error);
      throw new GhInstallError(cause.message, cause);
    }
    throw error;
  }
  const accountTokenValue = result.stdout.trim();
  if (accountTokenValue === "") throw new GhLoginError(account);
  return accountTokenValue;
}

function redact(text: string, token: string): string {
  if (token === "") return text;
  return text.split(token).join("***");
}

function repositoryError(error: unknown, token: string): GhSessionError {
  if (error instanceof CommandNotFoundError || error instanceof ProgramFileError) {
    const safeCause = sanitizeError(error, token);
    return new GhInstallError(safeCause.message, safeCause);
  }
  if (isAccessDenied(error)) {
    const safeCause = sanitizeError(error, token);
    return new GhInstallError(safeCause.message, safeCause);
  }
  if (error instanceof GhProcessError) {
    const stdout = redact(error.stdout, token);
    const stderr = redact(error.stderr, token).trim();
    const subcommand = redact(error.subcommand, token);
    const message = redact(error.message, token);
    const safeCause = sanitizeError(error, token);
    return new GhSessionError(message, { subcommand, stdout, stderr, exitCode: error.exitCode }, safeCause);
  }
  const safeCause = error instanceof Error ? sanitizeError(error, token) : new Error(redact(String(error), token));
  return new GhSessionError(safeCause.message, {}, safeCause);
}

function isAccessDenied(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EACCES";
}

function sanitizeError(error: Error, token = "", seen = new Map<object, unknown>()): Error {
  const prior = seen.get(error);
  if (prior instanceof Error) return prior;
  const safe = new Error(redact(error.message, token));
  seen.set(error, safe);
  safe.name = redact(error.name, token);
  if (error.stack !== undefined) safe.stack = redact(error.stack, token);
  if ("cause" in error) {
    Object.defineProperty(safe, "cause", {
      configurable: true,
      enumerable: false,
      value: sanitizeValue(error.cause, token, seen),
      writable: true,
    });
  }
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === "name" || key === "message" || key === "stack" || key === "cause") continue;
    const value = (error as unknown as Record<string, unknown>)[key];
    Object.defineProperty(safe, key, {
      configurable: true,
      enumerable: Object.prototype.propertyIsEnumerable.call(error, key),
      value:
        key === "stderr" && typeof value === "string" ? redact(value, token).trim() : sanitizeValue(value, token, seen),
      writable: true,
    });
  }
  return safe;
}

function sanitizeValue(value: unknown, token: string, seen: Map<object, unknown>): unknown {
  if (typeof value === "string") return redact(value, token);
  if (value === null || typeof value !== "object") return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior;
  if (value instanceof Error) return sanitizeError(value, token, seen);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    result.push(...value.map((item) => sanitizeValue(item, token, seen)));
    return result;
  }
  const result: Record<string, unknown> = {};
  seen.set(value, result);
  for (const key of Object.getOwnPropertyNames(value)) {
    try {
      result[key] = sanitizeValue((value as Record<string, unknown>)[key], token, seen);
    } catch {
      result[key] = "[unavailable]";
    }
  }
  return result;
}
