import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isSet, relativePathReason } from "../../config/path.js";
import type { Check, CheckResult } from "../../doctor/check.js";
import { firstLine } from "../../doctor/first-line.js";
import { isOlderVersion } from "../../doctor/version-compare.js";
import { ProgramFileError } from "../../process/resolve-program.js";
import { timedCheck } from "../../doctor/timed-check.js";
import { isObject } from "../../object.js";
import { runProgramCheck } from "../program-check.js";
import { upstreamOf } from "../models.js";
import type { AssistantDoctorRepo } from "../provider.js";
import { piChildEnv } from "./child-env.js";
import { piProgram } from "./program.js";

const PI_INSTALL_FIX = "Install pi and put pi on PATH, or set TASKER_PI_BIN.";
const PI_AGENT_DIR_FIX = "Set TASKER_PI_CODING_AGENT_DIR to an absolute path, or unset it.";
const HOME_FIX = "Set HOME.";
const SUPERPOWERS_SOURCE = "git:github.com/obra/superpowers";
const SUPERPOWERS_INSTALL_FIX = `Run pi install ${SUPERPOWERS_SOURCE}.`;
const MINIMUM_SUPERPOWERS = [6, 4, 1] as const;
const ROLES = ["plan", "execute", "review"] as const;

function environmentRefusal(
  env: NodeJS.ProcessEnv,
): { result: CheckResult; env?: undefined } | { env: NodeJS.ProcessEnv; result?: undefined } {
  const relativeReason = relativePathReason("TASKER_PI_CODING_AGENT_DIR", env.TASKER_PI_CODING_AGENT_DIR);
  if (relativeReason !== undefined) {
    return { result: { status: "error", detail: relativeReason, remediation: PI_AGENT_DIR_FIX } };
  }
  const piEnv = piChildEnv(env);
  if ("reason" in piEnv) {
    return { result: { status: "error", detail: piEnv.reason, remediation: HOME_FIX } };
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
      notInstalled: `${program} is not installed or not on PATH`,
      remediation: PI_INSTALL_FIX,
      readChild,
    });
  });
}

export function piVersionCheck(timeoutMs = 5000): Check {
  return piProgramCheck("pi version", ["--version"], timeoutMs, (child, exitDetail) =>
    child.code === 0 ? { status: "ok", detail: firstLine(child.stdout) } : { status: "error", detail: exitDetail },
  );
}

export function piAuthCheck(upstream: string, timeoutMs = 10_000): Check {
  const args = ["auth", "check", "--provider", upstream, "--json"];
  return piProgramCheck(`pi-auth:${upstream}`, args, timeoutMs, (child, exitDetail) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(child.stdout);
    } catch {
      return { status: "error", detail: exitDetail };
    }
    if (!isObject(parsed)) return { status: "error", detail: exitDetail };
    if (child.code === 0 && parsed.status === "ready") {
      const authType = typeof parsed.authType === "string" ? parsed.authType : "unknown auth type";
      return { status: "ok", detail: `pi has credentials for ${upstream} (${authType})` };
    }
    if (parsed.reason === "provider_not_found") {
      return {
        status: "error",
        detail: `pi does not know the provider ${upstream}`,
        remediation: `Fix the model of each role that names ${upstream}.`,
      };
    }
    if (parsed.reason === "credentials_not_configured") {
      return {
        status: "error",
        detail: `pi has no credentials for ${upstream}`,
        remediation: `Run pi and log in to ${upstream} with /login.`,
      };
    }
    if (typeof parsed.status === "string" && parsed.status !== "ready") {
      const reason = typeof parsed.reason === "string" ? ` (${parsed.reason})` : "";
      return { status: "error", detail: `pi cannot use the credentials for ${upstream}: ${parsed.status}${reason}` };
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
  let inUserPackages = false;
  let source: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line === "User packages:") {
      inUserPackages = true;
      continue;
    }
    if (!inUserPackages) continue;
    if (!line.startsWith("  ")) break;
    const sourceMatch = /^ {2}(?! )(\S.*)$/.exec(line);
    if (sourceMatch) {
      source = sourceMatch[1].replace(/ \(filtered\)$/, "");
      continue;
    }
    const pathMatch = /^ {4}(?! )(\S.*)$/.exec(line);
    if (pathMatch && source !== undefined) {
      entries.push({ source, installPath: pathMatch[1] });
    }
    source = undefined;
  }
  return entries;
}

interface InstalledSuperpowers extends PackageEntry {
  version: unknown;
}

function installedSuperpowers(output: string): InstalledSuperpowers | undefined {
  for (const entry of packageEntries(output)) {
    try {
      const info: unknown = JSON.parse(readFileSync(join(entry.installPath, "package.json"), "utf8"));
      if (isObject(info) && info.name === "superpowers") return { ...entry, version: info.version };
    } catch {
      // An unreadable package file does not identify a package.
    }
  }
  return undefined;
}

function versionParts(version: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? match.slice(1, 4).map(Number) : undefined;
}

export function superpowersCheck(timeoutMs = 5000): Check {
  return piProgramCheck("superpowers:pi", ["list", "--no-approve"], timeoutMs, (child, exitDetail) => {
    if (child.code !== 0) return { status: "error", detail: exitDetail };
    const installed = installedSuperpowers(child.stdout);
    if (installed === undefined) {
      return { status: "error", detail: "pi has no superpowers package", remediation: SUPERPOWERS_INSTALL_FIX };
    }
    const version = installed.version;
    const parts = typeof version === "string" ? versionParts(version) : undefined;
    if (parts === undefined) {
      return {
        status: "error",
        detail: `cannot read the version of superpowers in ${join(installed.installPath, "package.json")}`,
      };
    }
    const versionText = String(version);
    if (!isOlderVersion(parts, MINIMUM_SUPERPOWERS)) {
      return { status: "ok", detail: `superpowers ${versionText} at ${installed.installPath}` };
    }
    const local = !/^(?:npm:|git:|github:|http:|https:|ssh:|builtin:)/.test(installed.source);
    const remediation = local
      ? `Update the files at ${installed.installPath}.`
      : `Run pi update --extension ${installed.source}. If ${installed.source} names a ref or a version, run pi install with the source that names none.`;
    return {
      status: "error",
      detail: `superpowers ${versionText} is older than 6.4.1`,
      remediation,
    };
  });
}

export function simpleEnglishCheck(timeoutMs = 1000): Check {
  return timedCheck({ name: "simple-english:pi", required: true, timeoutMs }, async (env) => {
    const folders: string[] = [];
    const piEnv = piChildEnv(env);
    if ("env" in piEnv) {
      const agentDir = piEnv.env.PI_CODING_AGENT_DIR ?? "";
      folders.push(join(agentDir, "skills"));
    }
    if (isSet(env.HOME)) folders.push(join(env.HOME, ".agents", "skills"));
    if (folders.length === 0) {
      return { status: "error", detail: "tasker cannot find the skill folders of pi, because HOME is not set" };
    }
    const skillPath = folders
      .map((folder) => join(folder, "simple-english", "SKILL.md"))
      .find((path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true);
    if (skillPath !== undefined) return { status: "ok", detail: `simple-english at ${skillPath}` };
    const lastFolder = folders.at(-1)!;
    return {
      status: "error",
      detail: `simple-english/SKILL.md is in no skill folder of pi: ${folders.join(", ")}`,
      remediation: `Install the skill simple-english in ${lastFolder}.`,
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
