import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, parse } from "node:path";
import { GitError, runGit } from "./run.js";
import { runRemoteGit } from "./ssh.js";

// The same structure as the output of GitConfigSchema, so a caller passes repo.vcs.config.
export interface GitVcsConfig {
  authorName?: string;
  authorEmail?: string;
  sshKey?: string;
}

export interface ProvisionOptions {
  remote: string;
  clone: string;
  config: GitVcsConfig;
  env: NodeJS.ProcessEnv;
}

// Makes the bare clone of the remote at options.clone and fetches all branches as origin/*.
// The marker file <clone>.incomplete exists while a fresh clone is not complete.
export async function provisionClone(options: ProvisionOptions): Promise<void> {
  const { remote, clone, config, env } = options;
  const marker = `${clone}.incomplete`;
  const root = parse(process.cwd()).root;

  // An earlier clone stopped partway. Delete what it left and clone again.
  if (existsSync(marker)) {
    rmSync(clone, { recursive: true, force: true });
  }

  // A complete clone only gets a fetch. Its remote.origin.url stays as it is.
  if (existsSync(clone) && !existsSync(marker)) {
    await applyConfig(clone, config, env);
    await runRemoteGit(["fetch", "--prune", "origin"], { gitDir: clone, env }, config.sshKey);
    return;
  }

  // The error text can hold git output, so the new error sets no cause.
  const failure = await runRemoteGit(
    ["ls-remote", "--exit-code", "--", remote],
    { cwd: root, env },
    config.sshKey,
  ).then(
    () => undefined,
    (error: unknown) => {
      if (error instanceof GitError) {
        return error;
      }
      throw error;
    },
  );
  if (failure?.exitCode === 2) {
    throw new Error(`the remote has no refs: ${remote}`);
  }
  if (failure !== undefined) {
    const detail = failure.stderr.trim();
    throw new Error(`the remote does not answer: ${remote}${detail === "" ? "" : `: ${detail}`}`);
  }

  mkdirSync(dirname(clone), { recursive: true });
  writeFileSync(marker, "");
  await runRemoteGit(
    ["clone", "--bare", "--", remote, clone],
    { cwd: dirname(clone), env },
    config.sshKey,
  );
  await runGit(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], {
    gitDir: clone,
    env,
  });
  await applyConfig(clone, config, env);
  await runRemoteGit(["fetch", "--prune", "origin"], { gitDir: clone, env }, config.sshKey);
  rmSync(marker, { force: true });
}

// Writes the identity of config and turns off signing. A field that is not set is unset.
async function applyConfig(
  clone: string,
  config: GitVcsConfig,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await setOrUnset(clone, "user.name", config.authorName, env);
  await setOrUnset(clone, "user.email", config.authorEmail, env);
  await setConfig(clone, ["commit.gpgSign", "false"], env);
  await setConfig(clone, ["tag.gpgSign", "false"], env);
  await setConfig(clone, ["tag.forceSignAnnotated", "false"], env);
}

async function setOrUnset(
  clone: string,
  key: string,
  value: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (value !== undefined) {
    await setConfig(clone, [key, value], env);
    return;
  }
  try {
    await setConfig(clone, ["--unset", key], env);
  } catch (error) {
    // Exit code 5 means that the key is not set.
    if (!(error instanceof GitError && error.exitCode === 5)) {
      throw error;
    }
  }
}

// One git config write in the clone.
function setConfig(clone: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  return runGit(["config", ...args], { gitDir: clone, env });
}
