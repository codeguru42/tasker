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

export const GIT_GLOBAL_OPTIONS = [
  {
    names: [
      "-C",
      "--git-dir",
      "--work-tree",
      "--namespace",
      "--super-prefix",
      "--shallow-file",
      "--attr-source",
      "--config-env",
      "--config",
      "-c",
    ],
    value: "required",
  },
  { names: ["--exec-path", "--list-cmds"], value: "optional-attached" },
  {
    names: [
      "-p",
      "--paginate",
      "-P",
      "--no-pager",
      "-h",
      "--no-replace-objects",
      "--no-lazy-fetch",
      "--no-optional-locks",
      "--no-advice",
      "--bare",
      "--literal-pathspecs",
      "--glob-pathspecs",
      "--noglob-pathspecs",
      "--icase-pathspecs",
      "--html-path",
      "--man-path",
      "--info-path",
      "--version",
      "--help",
    ],
    value: "none",
  },
] as const;

export const GIT_CONFIG_EXEC_OPTIONS = ["-c", "--config", "--config-env"] as const;

export const GIT_READERS = [
  { command: "rebase", options: ["-x", "--exec"], mode: "shell", standalone: false },
  { command: "bisect", options: ["run"], mode: "argv", standalone: true },
  { command: "submodule", options: ["foreach"], mode: "shell", standalone: true },
  { command: "difftool", options: ["-x", "--extcmd"], mode: "shell", standalone: false },
  {
    command: "filter-branch",
    options: ["--tree-filter", "--index-filter", "--commit-filter", "--msg-filter", "--env-filter", "--setup"],
    mode: "shell",
    standalone: false,
  },
  { command: "fetch", options: ["--upload-pack"], mode: "program", standalone: false },
  { command: "pull", options: ["--upload-pack"], mode: "program", standalone: false },
  { command: "ls-remote", options: ["--upload-pack"], mode: "program", standalone: false },
  { command: "archive", options: ["--exec"], mode: "program", standalone: false },
  { command: "clone", options: ["-u", "--upload-pack"], mode: "program", standalone: false },
  { command: "grep", options: ["-O", "--open-files-in-pager"], mode: "program", standalone: false },
] as const;

export const FIND_ACTIONS = ["-exec", "-execdir", "-ok", "-okdir"] as const;
export const FIND_VALUE_PREDICATES = [
  "-name",
  "-iname",
  "-path",
  "-ipath",
  "-user",
  "-group",
  "-type",
  "-perm",
  "-size",
  "-newer",
  "-mtime",
  "-mmin",
  "-maxdepth",
  "-mindepth",
] as const;
export const XARGS_SAFE_MODES = ["--version", "--help", "--show-limits"] as const;
export const GIT_COMMAND_ASSIGNMENTS = ["GIT_EDITOR", "GIT_SEQUENCE_EDITOR", "GIT_SSH_COMMAND"] as const;
