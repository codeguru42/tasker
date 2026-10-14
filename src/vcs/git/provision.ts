import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { replaceFile } from "../../replace-file.js";
import { fetchOrigin } from "./changes.js";
import type { GitVcsConfig } from "./config.js";
import { installPushHook } from "./push-guard.js";
import { GitError, isGitExit, runGit } from "./run.js";
import { cloneUrl, remoteCwd, remoteNotAnswering, runRemoteGit, sshCommand } from "./ssh.js";

const INCLUDE_FILE = "tasker-ssh.config";

export interface ProvisionOptions {
  remote: string;
  clone: string;
  config: GitVcsConfig;
  env: NodeJS.ProcessEnv;
  // The folder of the publish tokens. The hook reads it,
  // so it must name the same folder on each run.
  publishTokens: string;
}

// Makes the bare clone of the remote at options.clone, with no local branch, and fetches all
// branches as origin/*. The marker file <clone>.incomplete exists from before git init until the
// first fetch succeeds.
// If a step fails, the marker stays.
export async function provisionClone(options: ProvisionOptions): Promise<void> {
  const { remote, clone, config, env, publishTokens } = options;
  const marker = `${clone}.incomplete`;

  // An earlier clone stopped partway. Delete the clone folder and clone again.
  // The marker stays until the clone is complete.
  if (existsSync(marker)) {
    rmSync(clone, { recursive: true, force: true });
  }

  // A complete clone gets the clone configuration, including remote.origin.url from remote, and a fetch.
  if (existsSync(clone)) {
    await applyConfig(clone, remote, config, env, publishTokens);
    await fetchOrigin({ clone, env, sshKey: config.sshKey });
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
    throw remoteNotAnswering(remote, failure);
  }

  // The target is absolute, so the cwd of git init does not move the clone. A relative remote
  // names the same repo as in ls-remote, because remote add writes cloneUrl(remote).
  const target = resolve(clone);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(marker, "");
  // git init and remote add make no local branch. git clone --bare copies each remote branch to
  // refs/heads/*, and these copies do not move on fetch. sha1, because tasker reads only 40-hex
  // revisions, and a sha256 default of the user makes the fetch from a sha1 remote fail.
  await runGit(["init", "--bare", "--object-format=sha1", "--", target], { cwd: remoteCwd(), env });
  await runGit(["remote", "add", "--", "origin", cloneUrl(remote)], { gitDir: clone, env });
  await applyConfig(clone, remote, config, env, publishTokens);
  await fetchOrigin({ clone, env, sshKey: config.sshKey });
  rmSync(marker, { force: true });
}

// Writes the url and the fetch refspec of origin and the identity of config, turns off signing,
// and installs the pre-push hook.
// A field of the identity that is not set is unset.
async function applyConfig(
  clone: string,
  remote: string,
  config: GitVcsConfig,
  env: NodeJS.ProcessEnv,
  publishTokens: string,
): Promise<void> {
  await setConfig(clone, ["--replace-all", "remote.origin.url", cloneUrl(remote)], env);
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
  // A local value beats a global or system value. It must be absolute: a relative value
  // resolves against the worktree.
  await setConfig(clone, ["--replace-all", "core.hooksPath", resolve(clone, "hooks")], env);
  await setConfig(clone, ["--replace-all", "include.path", INCLUDE_FILE], env);
  // The include file goes last, so a failed git config call leaves it as it was.
  writeIncludeFile(clone, config.sshKey);
  installPushHook(clone, publishTokens);
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
  replaceFile(join(clone, INCLUDE_FILE), content, { followSymlink: false });
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
    if (!isGitExit(error, 5)) {
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
