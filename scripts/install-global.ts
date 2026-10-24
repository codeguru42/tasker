import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";

function failure(command: string, args: string[], result: SpawnSyncReturns<string | Buffer>): Error {
  const name = `${command} ${args.join(" ")}`;
  if (result.error) {
    return new Error(`${name} did not start: ${result.error.message}`);
  }
  if (result.signal) {
    return new Error(`${name} stopped with the signal ${result.signal}`);
  }
  return new Error(`${name} failed with exit code ${String(result.status)}`);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw failure(command, args, result);
  }
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
  if (result.error || result.status !== 0) {
    throw failure(command, args, result);
  }
  return result.stdout.trim();
}

function utcDate(now: Date): string {
  return `${now.getUTCFullYear()}.${now.getUTCMonth() + 1}.${now.getUTCDate()}`;
}

function problems(tags: string[], status: string): string[] {
  const found: string[] = [];
  if (tags.length > 1) {
    found.push(`HEAD has more than one tag: ${tags.join(", ")}. Keep one tag on HEAD.`);
  }
  if (status !== "") {
    found.push("the working tree has changes, also untracked files. Commit or remove them first.");
  }
  return found;
}

function main(): void {
  const tags = capture("git", ["tag", "--points-at", "HEAD"])
    .split("\n")
    .filter((line) => line !== "");
  const status = capture("git", ["status", "--porcelain"]);
  const found = problems(tags, status);
  if (found.length > 0) {
    for (const message of found) {
      process.stderr.write(`install:global: ${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const version = tags[0] ?? `${utcDate(new Date())}-${capture("git", ["rev-parse", "--short", "HEAD"])}`;
  const packageFile = `tasker-${version}.tgz`;
  let installError: Error | undefined;
  try {
    run("npm", ["ci"]);
    run("npm", ["pkg", "set", `version=${version}`]);
    run("npm", ["pack"]);
    run("npm", ["install", "-g", `./${packageFile}`]);
  } catch (error) {
    installError = asError(error);
  }
  let restoreError: Error | undefined;
  try {
    // This removes all changes to package.json. This is why the script needs a clean working tree.
    run("git", ["checkout", "package.json"]);
  } catch (error) {
    restoreError = asError(error);
  }
  rmSync(packageFile, { force: true });
  if (installError !== undefined && restoreError !== undefined) {
    throw new AggregateError([installError, restoreError]);
  }
  if (installError !== undefined) {
    throw installError;
  }
  if (restoreError !== undefined) {
    throw restoreError;
  }

  const printed = capture("tasker", ["--version"]);
  if (printed !== version) {
    throw new Error(`tasker --version prints "${printed}", but the version is "${version}".`);
  }
  run("tasker", ["install-skills"]);
}

try {
  main();
} catch (error) {
  const errors = error instanceof AggregateError ? (error.errors as unknown[]) : [error];
  for (const each of errors) {
    process.stderr.write(`install:global: ${messageOf(each)}\n`);
  }
  process.exitCode = 1;
}
