import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isSet } from "../../config/path.js";
import type { Check, CheckResult } from "../../doctor/check.js";
import { isOlderVersion } from "../../doctor/version-compare.js";
import { ProgramFileError } from "../../process/resolve-program.js";
import { timedCheck } from "../../doctor/timed-check.js";
import { runProgramCheck } from "../program-check.js";
import { upstreamOf } from "../models.js";
import type { AssistantDoctorRepo } from "../provider.js";
import { piChildEnv } from "./child-env.js";
import { piProgram } from "./program.js";

const PI_NOT_INSTALLED = "pi is not installed or not on PATH";
const PI_INSTALL_FIX = "Install pi and put pi on PATH, or set TASKER_PI_BIN.";
const PI_AGENT_DIR_FIX = "Set TASKER_PI_CODING_AGENT_DIR to an absolute path, or unset it.";
const HOME_FIX = "Set HOME.";
const SUPERPOWERS_SOURCE = "git:github.com/obra/superpowers";
const SUPERPOWERS_INSTALL_FIX = `Install superpowers with pi install ${SUPERPOWERS_SOURCE}.`;
const SUPERPOWERS_UPDATE_FIX = `Update superpowers with pi install ${SUPERPOWERS_SOURCE}.`;
const MINIMUM_SUPERPOWERS = [6, 4, 1] as const;
const ROLES = ["plan", "execute", "review"] as const;

function environmentRefusal(
  env: NodeJS.ProcessEnv,
): { result: CheckResult; env?: undefined } | { env: NodeJS.ProcessEnv; result?: undefined } {
  const piEnv = piChildEnv(env);
  if ("reason" in piEnv) {
    const relativeReason = piEnv.reason.startsWith("TASKER_PI_CODING_AGENT_DIR") ? PI_AGENT_DIR_FIX : HOME_FIX;
    return { result: { status: "error", detail: piEnv.reason, remediation: relativeReason } };
  }
  return { env: piEnv.env };
}

function piProgramCheck(
  name: string,
  args: readonly string[],
  timeoutMs: number,
  readChild: Parameters<typeof runProgramCheck>[0]["readChild"],
): Check {
  return timedCheck({ name, required: true, timeoutMs }, async (env, { signal }) => {
    const checked = environmentRefusal(env);
    if (checked.result !== undefined) return checked.result;
    let program: string;
    try {
      program = piProgram(env);
    } catch (error) {
      if (error instanceof ProgramFileError) {
        return { status: "error", detail: error.message, remediation: "Fix TASKER_PI_BIN." };
      }
      throw error;
    }
    return runProgramCheck({
      program,
      args,
      env: checked.env,
      signal,
      notInstalled: PI_NOT_INSTALLED,
      remediation: PI_INSTALL_FIX,
      readChild,
    });
  });
}

export function piVersionCheck(timeoutMs = 5000): Check {
  return piProgramCheck("pi version", ["--version"], timeoutMs, (child, exitDetail) =>
    child.code === 0
      ? { status: "ok", detail: firstVersionLine(child.stdout) }
      : { status: "error", detail: exitDetail },
  );
}

function firstVersionLine(output: string): string {
  const line = output.split("\n")[0].replace(/\r$/, "");
  return line.startsWith("pi ") ? line.slice(3) : line;
}

interface AuthReply {
  status?: unknown;
  provider?: unknown;
  reason?: unknown;
}

export function piAuthCheck(upstream: string, timeoutMs = 10_000): Check {
  const args = ["auth", "check", "--provider", upstream, "--json"];
  return piProgramCheck(`pi-auth:${upstream}`, args, timeoutMs, (child, exitDetail) => {
    let reply: AuthReply;
    try {
      reply = JSON.parse(child.stdout) as AuthReply;
    } catch {
      return { status: "error", detail: exitDetail };
    }
    if (child.code === 0 && reply.status === "ready" && reply.provider === upstream) {
      return { status: "ok", detail: `pi has a login for ${upstream}` };
    }
    if (reply.reason === "provider_not_found") {
      return { status: "error", detail: `pi auth check reported provider_not_found for ${upstream}` };
    }
    if (reply.reason === "credentials_not_configured") {
      return {
        status: "error",
        detail: `pi is not logged in for ${upstream}`,
        remediation: `Run /login in pi and select ${upstream}.`,
      };
    }
    return { status: "error", detail: exitDetail };
  });
}

interface PackageEntry {
  source: string;
  installPath: string;
}

function packageEntries(output: string): PackageEntry[] {
  const entries: PackageEntry[] = [];
  let userPackages = false;
  let source: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line === "User packages:") {
      userPackages = true;
      source = undefined;
      continue;
    }
    if (line === "Project packages:") {
      userPackages = false;
      source = undefined;
      continue;
    }
    const sourceMatch = /^ {2}(\S.*)$/.exec(line);
    if (sourceMatch) {
      source = userPackages ? sourceMatch[1] : undefined;
      continue;
    }
    const pathMatch = /^ {4}(\S.*)$/.exec(line);
    if (pathMatch && source !== undefined) {
      entries.push({ source, installPath: pathMatch[1] });
      source = undefined;
    }
  }
  return entries;
}

function sourceNamesSuperpowers(source: string): boolean {
  if (source.startsWith("git:")) {
    const refPath = source
      .slice("git:".length)
      .split("#", 1)[0]
      .replace(/\.git$/, "");
    return refPath.split("/").at(-1) === "superpowers";
  }
  if (source.startsWith("npm:")) {
    const packageName = source.slice("npm:".length).split("@", 1)[0];
    return packageName === "superpowers" || packageName.endsWith("/superpowers");
  }
  return false;
}

function installedSuperpowers(output: string): { version: string } | undefined {
  for (const entry of packageEntries(output)) {
    if (!sourceNamesSuperpowers(entry.source)) continue;
    try {
      const info = JSON.parse(readFileSync(join(entry.installPath, "package.json"), "utf8")) as { version?: unknown };
      if (typeof info.version === "string") return { version: info.version };
    } catch {
      // A package without an install path or readable package file is not installed.
    }
  }
  return undefined;
}

function versionParts(version: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  return match ? match.slice(1, 4).map(Number) : undefined;
}

export function superpowersCheck(timeoutMs = 5000): Check {
  return piProgramCheck("superpowers:pi", ["list", "--no-approve"], timeoutMs, (child, exitDetail) => {
    if (child.code !== 0) return { status: "error", detail: exitDetail };
    const installed = installedSuperpowers(child.stdout);
    if (installed === undefined) {
      return { status: "error", detail: "superpowers is not installed", remediation: SUPERPOWERS_INSTALL_FIX };
    }
    const parts = versionParts(installed.version);
    if (parts === undefined || isOlderVersion(parts, MINIMUM_SUPERPOWERS)) {
      return {
        status: "error",
        detail: `superpowers ${installed.version} is older than 6.4.1`,
        remediation: SUPERPOWERS_UPDATE_FIX,
      };
    }
    return { status: "ok", detail: `superpowers ${installed.version} is installed` };
  });
}

export function simpleEnglishCheck(timeoutMs = 1000): Check {
  return timedCheck({ name: "simple-english:pi", required: true, timeoutMs }, async (env) => {
    const folders: string[] = [];
    if (isSet(env.HOME)) folders.push(join(env.HOME, ".agents", "skills"));
    const piEnv = piChildEnv(env);
    if ("env" in piEnv) folders.push(join(piEnv.env.PI_CODING_AGENT_DIR!, "skills"));
    const found = folders.some((folder) => existsSync(join(folder, "simple-english", "SKILL.md")));
    return found
      ? { status: "ok", detail: "simple-english is installed for pi" }
      : {
          status: "error",
          detail: "simple-english is not installed for pi",
          remediation: "Install simple-english in $HOME/.agents/skills/ or the pi agent folder.",
        };
  });
}

export function piDoctorChecks(repos: readonly AssistantDoctorRepo[]): Check[] {
  if (repos.length === 0) return [];
  const upstreams = new Set<string>();
  for (const repo of repos) {
    for (const role of ROLES) {
      const upstream = upstreamOf(repo.assistant.models[role].model);
      if (upstream !== undefined) upstreams.add(upstream);
    }
  }
  return [
    piVersionCheck(),
    ...[...upstreams].map((upstream) => piAuthCheck(upstream)),
    superpowersCheck(),
    simpleEnglishCheck(),
  ];
}
