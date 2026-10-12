import { userInfo } from "node:os";
import { isAbsolute, parse } from "node:path";
import { GitError, runGit, type RunGitOptions } from "./run.js";

const HIDDEN = "<sshKey>";

// A text in single quotes for a shell script. Each ' in the text becomes '\''.
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

// The ssh command for a key: the path in single quotes, each ' written as '\''.
export function sshCommand(sshKey: string): string {
  return `ssh -i ${shellQuote(sshKey)} -o IdentitiesOnly=yes -o BatchMode=yes`;
}

// env plus GIT_SSH_COMMAND=sshCommand(sshKey) when sshKey is set. Without a key, env as it is.
export function sshEnv(env: NodeJS.ProcessEnv, sshKey: string | undefined): NodeJS.ProcessEnv {
  if (sshKey === undefined) {
    return env;
  }
  return { ...env, GIT_SSH_COMMAND: sshCommand(sshKey) };
}

// text with each hidden form replaced by "<sshKey>". Without a key, text as it is.
// The forms, in this order: the ssh command, the key, the "~/" expansion with homeDir,
// and, for "~name/...", the part of the key from its first "/".
export function hideSshKey(text: string, sshKey: string | undefined, homeDir: string): string {
  if (sshKey === undefined) {
    return text;
  }
  const forms = [sshCommand(sshKey), sshKey];
  if (sshKey.startsWith("~/")) {
    forms.push(homeDir + sshKey.slice(1));
  } else if (sshKey.startsWith("~")) {
    const slash = sshKey.indexOf("/");
    if (slash !== -1 && slash < sshKey.length - 1) {
      forms.push(sshKey.slice(slash));
    }
  }
  let result = text;
  for (const form of forms) {
    if (form !== "") {
      result = result.split(form).join(HIDDEN);
    }
  }
  return result;
}

// runGit() with sshEnv(options.env, sshKey). A GitError is rethrown as a new GitError
// whose message, stdout and stderr went through hideSshKey(). It sets no cause.
export async function runRemoteGit(
  args: readonly string[],
  options: RunGitOptions,
  sshKey: string | undefined,
): Promise<string> {
  try {
    return await runGit(args, { ...options, env: sshEnv(options.env, sshKey) });
  } catch (error) {
    if (!(error instanceof GitError)) {
      throw error;
    }
    const homeDir = userInfo().homedir;
    throw new GitError(
      hideSshKey(error.message, sshKey, homeDir),
      error.subcommand,
      hideSshKey(error.stdout, sshKey, homeDir),
      hideSshKey(error.stderr, sshKey, homeDir),
      error.exitCode,
    );
  }
}

// The cwd of each git call that names the remote: the root of the file system.
// One cwd for all of them, so a relative remote path names the same repo in each call.
export function remoteCwd(): string {
  return parse(process.cwd()).root;
}

// The remote.origin.url that git clone writes for remote, with remoteCwd() as cwd.
// A remote is a local path when it has no "://" and either no ":" or a "/" before its first ":"
// (the rule of git, url_is_local_not_ssh). A relative local path becomes remoteCwd() plus the
// path, with no normalizing. Any other remote stays as it is.
export function cloneUrl(remote: string): string {
  const colon = remote.indexOf(":");
  const slash = remote.indexOf("/");
  const local = !remote.includes("://") && (colon === -1 || (slash !== -1 && slash < colon));
  if (local && !isAbsolute(remote)) {
    return remoteCwd() + remote;
  }
  return remote;
}

// The error for a remote that does not answer.
// It sets no cause, because the text of git can hold secrets.
export function remoteNotAnswering(remote: string, failure: GitError): Error {
  const detail = failure.stderr.trim();
  return new Error(`the remote does not answer: ${remote}${detail === "" ? "" : `: ${detail}`}`);
}
