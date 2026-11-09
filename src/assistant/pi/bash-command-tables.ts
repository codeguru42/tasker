export const SHELLS = {
  bash: { family: "bash", flags: "abefhklmnptuvxBCEHPT" },
  sh: { family: "posix", flags: "abefnuvx" },
  zsh: { family: "posix", flags: "cliex" },
  ksh: { family: "posix", flags: "cliex" },
  dash: { family: "posix", flags: "abefnuvx" },
  rbash: { family: "bash", flags: "abefhklmnptuvxBCEHPT" },
  ash: { family: "posix", flags: "abefnuvx" },
  mksh: { family: "posix", flags: "cliex" },
  yash: { family: "posix", flags: "cliex" },
  fish: { family: "fish", flags: "cliex" },
} as const;

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

export const ALIAS_READ_OPTIONS = ["-p"] as const;
export const COMMAND_TEXT_ASSIGNMENTS = ["EDITOR", "VISUAL", "PAGER"] as const;
export const BASH_INIT_FILE_OPTIONS = ["--rcfile", "--init-file"] as const;
export const HISTORY_BINDING_OPTIONS = ["history", "histexpand"] as const;

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
  { names: ["--exec-path"], value: "optional-attached" },
  { names: ["--list-cmds"], value: "attached-required" },
  {
    names: [
      "-p",
      "-v",
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
  { command: "rebase", options: ["-x", "--exec"], standalone: false },
  { command: "bisect", options: ["run"], standalone: true },
  { command: "submodule", options: ["foreach"], standalone: true },
  { command: "difftool", options: ["-x", "--extcmd"], standalone: false },
  {
    command: "filter-branch",
    options: ["--tree-filter", "--index-filter", "--commit-filter", "--msg-filter", "--env-filter", "--setup"],
    standalone: false,
  },
  { command: "fetch", options: ["--upload-pack"], standalone: false },
  { command: "pull", options: ["--upload-pack"], standalone: false },
  { command: "ls-remote", options: ["--upload-pack"], standalone: false },
  { command: "archive", options: ["--exec"], standalone: false },
  { command: "clone", options: ["-u", "--upload-pack"], standalone: false },
  { command: "grep", options: ["-O", "--open-files-in-pager"], standalone: false },
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
export const XARGS_SAFE_COMMANDS = ["ls", "echo"] as const;
export const XARGS_SAFE_OPTIONS = ["-0", "--null", "-r", "--no-run-if-empty"] as const;
export const XARGS_VALUE_OPTIONS = [
  "-I",
  "--replace",
  "-L",
  "--max-lines",
  "-n",
  "--max-args",
  "-P",
  "--max-procs",
  "-d",
  "--delimiter",
  "-E",
  "--eof",
  "-a",
  "--arg-file",
] as const;
export const GIT_COMMAND_ASSIGNMENT_PREFIX = "GIT_";
