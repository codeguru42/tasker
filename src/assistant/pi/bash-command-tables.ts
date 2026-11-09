export const SHELLS = {
  bash: { family: "bash", flags: "abefhklmnptuvxBCEHPT" },
  sh: { family: "posix", flags: "abefnuvx" },
  zsh: { family: "posix", flags: "abefnuvx" },
  ksh: { family: "posix", flags: "abefnuvx" },
  dash: { family: "posix", flags: "abefnuvx" },
  rbash: { family: "bash", flags: "abefhklmnptuvxBCEHPT" },
  ash: { family: "posix", flags: "abefnuvx" },
  mksh: { family: "posix", flags: "abefnuvx" },
  yash: { family: "posix", flags: "abefnuvx" },
} as const;

export const LINE_READERS = ["eval", ...Object.keys(SHELLS)] as const;

export const CALLBACK_READERS = ["mapfile", "readarray"] as const;

export const COMMAND_STRING_READERS = ["flock", "su", "script"] as const;

export const WRAPPERS = [
  "env",
  "nice",
  "timeout",
  "watch",
  "nohup",
  "command",
  "stdbuf",
  "sudo",
  "exec",
  "doas",
  "setsid",
  "ionice",
  "chrt",
  "taskset",
  "flock",
  "busybox",
] as const;

export const SPECIAL_ASSIGNMENTS = ["BASH_ENV", "ENV"] as const;

export const BINDING_COMMANDS = ["alias", "fc", "set", "history", "trap"] as const;

export const VALUE_OPTIONS: Record<string, readonly string[]> = {
  env: ["-u", "--unset", "-C", "--chdir"],
  nice: ["-n", "--adjustment"],
  timeout: ["-k", "--kill-after", "-s", "--signal"],
  watch: ["-n", "--interval", "-t", "--chgexit", "-p", "--precise"],
  sudo: [
    "-u",
    "--user",
    "-g",
    "--group",
    "-h",
    "--host",
    "-p",
    "--prompt",
    "-C",
    "--close-from",
    "-T",
    "--command-timeout",
    "-R",
    "--chroot",
    "-D",
    "--chdir",
    "-r",
    "--role",
    "-t",
    "--type",
  ],
  doas: ["-u", "-C"],
  setsid: ["-w", "--wait"],
  ionice: ["-c", "-n", "-p"],
  chrt: ["-p", "-r", "-f", "-o", "-i", "-d", "--pid"],
  taskset: ["-c", "--cpu-list", "-p", "--pid"],
  flock: ["-E", "-w", "--conflict-exit-code", "--timeout"],
  stdbuf: ["-i", "-o", "-e"],
  script: ["-c", "--command", "-t", "--timing", "-T", "--log-timing", "-O", "--log-out", "-I", "--log-in"],
  su: ["-c", "--command", "-s", "--shell", "-g", "--group", "-G", "--supp-group", "-w", "--whitelist-environment"],
};
