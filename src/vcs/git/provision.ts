import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GitError, runGit } from "./run.js";
import { remoteCwd, runRemoteGit, sshCommand } from "./ssh.js";

const INCLUDE_FILE = "tasker-ssh.config";

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
// The marker file <clone>.incomplete exists from before git clone until the first fetch succeeds.
// If a step fails, the marker stays.
export async function provisionClone(options: ProvisionOptions): Promise<void> {
  const { remote, clone, config, env } = options;
  const marker = `${clone}.incomplete`;

  // An earlier clone stopped partway. Delete the clone folder and clone again.
  // The marker stays until the clone is complete.
  if (existsSync(marker)) {
    rmSync(clone, { recursive: true, force: true });
  }

  // A complete clone gets the clone configuration and a fetch. Its remote.origin.url stays as it is.
  if (existsSync(clone)) {
    await applyConfig(clone, config, env);
    await runRemoteGit(["fetch", "--prune", "origin"], { gitDir: clone, env }, config.sshKey);
    return;
  }

  // The error text can hold git output, so the new error sets no cause.
  const failure = await runRemoteGit(
    ["ls-remote", "--exit-code", "--", remote],
    { cwd: remoteCwd(), env },
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

  // The clone runs from the same cwd as ls-remote, so it needs an absolute destination.
  const target = resolve(clone);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(marker, "");
  await runRemoteGit(
    ["clone", "--bare", "--", remote, target],
    { cwd: remoteCwd(), env },
    config.sshKey,
  );
  await applyConfig(clone, config, env);
  await runRemoteGit(["fetch", "--prune", "origin"], { gitDir: clone, env }, config.sshKey);
  rmSync(marker, { force: true });
}

// Writes the fetch refspec and the identity of config, and turns off signing.
// A field of the identity that is not set is unset.
async function applyConfig(
  clone: string,
  config: GitVcsConfig,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await setConfig(
    clone,
    ["--replace-all", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"],
    env,
  );
  await setOrUnset(clone, "user.name", config.authorName, env);
  await setOrUnset(clone, "user.email", config.authorEmail, env);
  await setConfig(clone, ["--replace-all", "commit.gpgSign", "false"], env);
  await setConfig(clone, ["--replace-all", "tag.gpgSign", "false"], env);
  await setConfig(clone, ["--replace-all", "tag.forceSignAnnotated", "false"], env);
  await setConfig(clone, ["--replace-all", "include.path", INCLUDE_FILE], env);
  // The include file goes last, so a failed git config call leaves it as it was.
  writeIncludeFile(clone, config.sshKey);
}

// Writes the include file through a temp file and a rename. The value is in double quotes:
// git reads \\, \" and \n as escapes there, and every other character as it is.
function writeIncludeFile(clone: string, sshKey: string | undefined): void {
  let content = "";
  if (sshKey !== undefined) {
    const value = sshCommand(sshKey)
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("\n", "\\n");
    content = `[core]\n\tsshCommand = "${value}"\n`;
  }
  const temp = join(clone, `${INCLUDE_FILE}.tmp`);
  writeFileSync(temp, content);
  renameSync(temp, join(clone, INCLUDE_FILE));
}

async function setOrUnset(
  clone: string,
  key: string,
  value: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (value !== undefined) {
    await setConfig(clone, ["--replace-all", key, value], env);
    return;
  }
  try {
    await setConfig(clone, ["--unset-all", key], env);
  } catch (error) {
    // Exit code 5 of --unset-all means that the key is missing.
    if (!(error instanceof GitError && error.exitCode === 5)) {
      throw error;
    }
  }
}

// One git config write in the clone. When it fails and config.lock exists, the clone is locked.
async function setConfig(
  clone: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    await runGit(["config", ...args], { gitDir: clone, env });
  } catch (error) {
    if (existsSync(join(clone, "config.lock"))) {
      // The new error sets no cause: it needs no text of git.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`the clone configuration is locked: ${clone}`);
    }
    throw error;
  }
}
