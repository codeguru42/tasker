import type { SandboxLimits } from "../provider.js";

// The settings of claude for a sandboxed run. claude must refuse to start when it cannot build the sandbox,
// and a command must never ask to leave it. The network stays open. With a socket folder, it is the only
// Unix socket that a command can use. allowAllUnixSockets is never set: it opens the sockets of the
// ssh agent and the keyring.
export function sandboxSettings(limits: SandboxLimits, socketFolder: string | undefined): Record<string, unknown> {
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: { allowWrite: [...limits.allowWrite], denyRead: [...limits.denyRead] },
      network: {
        allowedDomains: ["*"],
        ...(socketFolder === undefined ? {} : { allowUnixSockets: [socketFolder] }),
      },
    },
  };
}
