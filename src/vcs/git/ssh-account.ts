import { spawn } from "node:child_process";
import { gitSshCommand } from "./run.js";
import { isLocalRemote, sshEnv } from "./ssh.js";

export interface SshTarget {
  destination: string;
  port?: string;
}

export type SshAccount =
  | { state: "found"; account: string }
  | { state: "none" }
  | { state: "git-ssh" };

const SSH_URL = /^(?:ssh|git\+ssh|ssh\+git):\/\/([^/]*)/i;

// The ssh destination and port of remote, or undefined when remote does not use ssh.
// A destination, a user or a port that ssh could read as an option gives undefined.
export function sshTarget(remote: string): SshTarget | undefined {
  if (isLocalRemote(remote)) {
    return undefined;
  }
  let authority: string;
  let port: string | undefined;
  const url = SSH_URL.exec(remote);
  if (url !== null) {
    authority = url[1];
    const end = authority.lastIndexOf("@") + 1;
    const rest = authority.slice(end);
    let host: string;
    if (rest.startsWith("[")) {
      const close = rest.indexOf("]");
      if (close === -1) {
        return undefined;
      }
      host = rest.slice(1, close);
      const after = rest.slice(close + 1);
      port = after.startsWith(":") ? after.slice(1) : after === "" ? undefined : "x";
    } else {
      const colon = rest.lastIndexOf(":");
      host = colon === -1 ? rest : rest.slice(0, colon);
      port = colon === -1 ? undefined : rest.slice(colon + 1);
    }
    authority = authority.slice(0, end) + host;
  } else if (remote.includes("://")) {
    return undefined;
  } else {
    authority = remote.slice(0, remote.indexOf(":"));
  }
  const at = authority.lastIndexOf("@");
  const user = at === -1 ? "" : authority.slice(0, at);
  const host = authority.slice(at + 1);
  if (host === "" || host.startsWith("-") || user.startsWith("-")) {
    return undefined;
  }
  if (port === "") {
    port = undefined;
  }
  if (port !== undefined && !/^\d+$/.test(port)) {
    return undefined;
  }
  return port === undefined ? { destination: authority } : { destination: authority, port };
}

const GREETING = /Hi ([^!\s]+)! You've successfully authenticated/;

// The account that the remote sees for the ssh key, read from the greeting that GitHub prints.
// Git has no command that shows the greeting, so this is the one place that starts ssh directly.
// It gives no ssh text. On abort, it rejects with the abort error.
export function sshAccount(options: {
  remote: string;
  sshKey: string | undefined;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}): Promise<SshAccount> {
  const target = sshTarget(options.remote);
  const probeEnv = sshEnv(options.env, options.sshKey);
  const command = gitSshCommand(probeEnv);
  if (command === undefined) {
    return Promise.resolve({ state: "git-ssh" });
  }
  if (target === undefined || !probeEnv.PATH) {
    return Promise.resolve({ state: "none" });
  }
  const args = [
    "-c",
    `${command} "$@"`,
    command,
    "-T",
    ...(target.port === undefined ? [] : ["-p", target.port]),
    "--",
    target.destination,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("sh", args, {
      env: probeEnv,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => output.push(chunk));
    child.on("error", (error: Error) => {
      if (error.name === "AbortError") {
        // An ssh child that sh left running must not hold the pipes open.
        child.stdout.destroy();
        child.stderr.destroy();
        reject(error);
      } else {
        resolve({ state: "none" });
      }
    });
    child.on("close", () => {
      const match = GREETING.exec(Buffer.concat(output).toString("utf8"));
      resolve(match === null ? { state: "none" } : { state: "found", account: match[1] });
    });
  });
}
