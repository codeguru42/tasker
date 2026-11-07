# Assistants

An assistant is a coding-agent program. Tasker starts it in the worktree of a task to plan, to execute and to review.
The assistant interface lets tasker run each assistant program in the same way. A command never imports the module of
one assistant.

tasker stores a value that an assistant gives for a session in one form for each provider. The code that stores and
passes the value has no case for one provider. Each provider turns the report of its program into that form, and a
provider with no such value leaves it NULL. An example is the `usage` event, which holds the four counters of
`TokenUsage` for one run or `"unavailable"`, for each provider. A name of a column names no provider.

## Refuse, never drop

A provider that cannot enforce a limit that tasker asks for (`access`, `deniedCommands`, `deniedEditPaths` or `sandbox`)
must refuse the run before it starts the program. A run with less confinement than tasker asked for can write or read
outside the limits that the user relies on. The doc comment of the interface holds the rule for the code.

There is one exception. For `codex`, the provider writes no rule for `deniedCommands`, and it does not refuse a run
because the list is not empty. The sandbox is the only limit, and it blocks only some commands of the list.
[The codex provider](#the-codex-provider) says which commands stay open.

## The session id

The caller must make the session id and must record it before the run. As a result, a crash, a timeout or a quota stop
still leaves an id to continue. No provider has to report an id. A provider can still report the id that its program
makes. A continued `codex` run needs that id.

## The outcome of an interrupted run

When tasker passes SIGINT or SIGTERM to a run, the provider gives the outcome `interrupted` with that signal. A quota
outcome wins over it, because a quota outcome rests on a parsed event. The interrupted outcome wins over a failure and
over a timeout.

## The prompt

A provider must send the prompt on stdin, never in argv. A prompt can be longer than the argv limit of the system.

## New and continued sessions

A new session uses the provider, the model and the effort of the configuration. A continued session must use the
provider, the model and the effort that it recorded when it started, also after the configuration changed. A continued
session also trusts the extensions that it recorded at its start, and the extensions of the current configuration. The
session and its context belong to that assistant and that model. A change of the provider, the model or the effort
applies to new sessions only.

## The limits of a run

Each run gets typed limits in `RunInput`. The limits name no assistant, so a new provider has no syntax of Claude Code
to parse.

| Field             | Type                                 | Meaning                                                                                                                   |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `access`          | `"read-only"` or `"workspace-write"` | Whether the edit tools can change files of the worktree                                                                   |
| `deniedCommands`  | `readonly string[]`                  | Each entry is the leading words of a shell command that the assistant must not run, for example `git push`                |
| `deniedEditPaths` | `readonly string[]`                  | Each entry is an absolute path that the edit tools must not change. An entry that ends in `/**` covers each path under it |

Each role gets these limits. [The assistant surface](version-control.md#assistant-surface) gives the entries of the
surface.

| Role         | `access`          | `deniedCommands`                        | `deniedEditPaths`                                     |
| ------------ | ----------------- | --------------------------------------- | ----------------------------------------------------- |
| plan, review | `read-only`       | the entries of the surface, and `herdr` | `[]`                                                  |
| execute      | `workspace-write` | the entries of the surface              | `<worktree>/.git`, `<worktree>/.git/**`, `<clone>/**` |

`<clone>` is `sandbox.sharedFolder`.

## The limits of each role

A task runs the assistant in one of three roles: plan, execute or review. The plan and review roles share one set of
limits and differ only in their model. The execute role has its own limits, because it does more steps than the other
two.

### The plan and review roles

These roles run in the plan mode. Their shell runs in the sandbox of [the execute role](#the-execute-role), with the
same write paths and the same read deny list. Under `claude-code`, their shell also gets two deny rules: one blocks
`git push`, and one blocks each `herdr` command. Under `codex`, the run gets no deny rule (see
[The codex provider](#the-codex-provider)). The deadline is the plan deadline of the configuration.

The plan mode blocks `Edit` and `Write`, but it does not block a shell command that writes. A host test on `claude`
2.1.300 showed this. The sandbox keeps the writes of the shell in the write paths of the sandbox. The provider refuses
these roles in the same cases as the execute role (see [Sandbox](#sandbox)).

herdr is the terminal workspace manager that holds the sessions of the user. The reason for the deny rule of `herdr`: a
session that can send input to the pane of another session can approve the permission prompts of that session. These
`herdr` commands act on another pane or another session (herdr 0.9.3, measured on 2026-10-25):

- Input: `pane send-text`, `pane send-keys`, `pane run`, `agent send-keys` and `agent prompt`.
- Close or stop: `pane close`, `tab close`, `workspace close`, `worktree remove`, `session stop` and `session delete`.
  With no target of its own, `server stop` stops the server that holds all the sessions.
- Start or attach: `agent start`, `agent attach` and `session attach`.
- Other changes: `pane split`, `pane swap`, `pane move`, `pane resize`, `pane zoom`, `pane focus`, `pane rename`,
  `pane input`, `pane report-agent`, `pane report-agent-session`, `pane release-agent`, `pane report-metadata`,
  `agent rename`, `agent focus`, `tab create`, `tab rename`, `tab focus`, `workspace create`, `workspace rename`,
  `workspace focus`, `workspace report-metadata`, `worktree create` and `worktree open`.
- Reads: `pane read`, `pane wait-output`, `pane get`, `pane current`, `pane layout`, `pane process-info`,
  `pane neighbor`, `pane edges`, `pane list`, `agent read`, `agent wait`, `agent get`, `agent explain`, `agent list`,
  `tab get`, `tab list`, `workspace get`, `workspace list`, `worktree list` and `session list`.

The deny rule does not cover `sh -c 'herdr agent list'`, and it also does not cover other forms that start a new shell,
for example `bash -c 'herdr agent list'` and `printf 'herdr agent list' | sh` (`claude` 2.1.310). It covers
`cd /tmp && herdr agent list`, `env herdr agent list` and the absolute path of the `herdr` program. In the sandbox of
these roles, `herdr agent list` and `sh -c 'herdr agent list'` exit with 1 and print `Operation not permitted` (measured
on 2026-10-25).

### The execute role

The execute role runs under the `default` permission mode, with a `PermissionRequest` hook of tasker. The hook answers
each question that no allow rule or deny rule decides. It allows only a Write or an Edit under
`<worktree>/.claude/skills/`. It denies each other question, so a tool call that no allow rule covers is still denied.
The hook writes no file. The deny rules run before the hook.

These facts of `claude` 2.1.310 give the reason for the mode. Under `dontAsk`, `claude` denies each write under
`.claude/`, also with an allow rule, a sandbox write path or a `PreToolUse` hook, and a `PermissionRequest` hook does
not run. Under `default`, the hook can answer. The hook allows only the one folder `.claude/skills/`, because a write to
`.claude/settings.json` can change the permissions of a later session. The shell still cannot write under
`.claude/skills/`, because the sandbox blocks it.

The hook makes four checks on `tool_input.file_path`, in this order. It denies the question at the first check that
fails, and the deny message gives the reason:

1. The path is absolute.
2. No part of the path is `.` or `..`.
3. As text, the path starts with `<worktree>/.claude/skills/` and has a part after that prefix.
4. No part of the path, from `<worktree>/.claude` down, is a symbolic link. The hook reads each part with `lstat`. It
   stops at the first part that does not exist.

The Write tool of `claude` 2.1.310 resolves `..` as text before it writes, and the kernel follows a link first. A real
path would have to follow both rules, and the two can disagree. A check on the text, with no link and no `.` or `..`
part, needs no real path. As a result, the text of the path and the path that the kernel writes cannot disagree.

The deadline is the execute deadline of the configuration. One deadline covers every turn of a run. A start can replace
it with the time that is left (see "The rules for the caller").

The allow list holds these rules, in this order:

- `Read`, `Glob` and `Grep`, each limited to the worktree.
- `Edit` and `Write`, each limited to the worktree.
- The shell, which runs in the sandbox.
- `StructuredOutput`.
- `Skill`.
- `TodoWrite`.
- `NotebookEdit`, limited to the worktree.
- `Agent` and `Task`.
- `Read` of `<configuration folder>/skills/**` and of `<configuration folder>/plugins/**`.

`Read`, `Glob` and `Grep` need a path rule. A plain `Glob` or `Grep` lists and searches files outside the worktree. A
host test showed this. With a path rule, a call outside the worktree is denied. Without any `Glob` or `Grep` rule, the
tools are not available at all.

The deny list names only `Edit` for the `.git` entry of the worktree and for the shared git folder of the clone. The
`Edit` rules cover each tool that edits a file, also `Write`. `claude` 2.1.310 warns that a `Write` deny rule does not
match in the file permission checks. A deny wins over an allow. As a result, git data changes only through `git`
commands in the sandboxed shell.

The sandbox stops `herdr`. In the sandboxed shell, `herdr agent list`, `sh -c 'herdr agent list'` and the absolute path
of the `herdr` program each exit with 1 and print `Operation not permitted` (herdr 0.9.3, `claude` 2.1.310, measured on
2026-10-25). As a result, the execute role gets no deny rule for `herdr`.

The sandbox follows the rules in [Sandbox](#sandbox). Its write paths and its shared folder come from the version
control. Its read deny list holds these paths:

- The ssh key of every configured repo. The version control gives it.
- The `.ssh` folder of the user.
- The folder of the `gh` configuration.
- The git credentials file and the `.netrc` file.
- The credentials file of Claude Code.
- The credentials file of Codex.
- The files `auth.json`, `mcp-auth.json` and `models.json` in up to three agent folders of `pi`, as
  [The agent folder](#the-agent-folder) says.
- The folder of the publish tokens of every configured repo. The version control gives it.
- The configuration of tasker.

With the key of any repo, the shell can push to that repo, because the network stays open (see the limits of
[Sandbox](#sandbox)). This is the reason for the items of every configured repo in the list. Each path of the list is
absolute, because the shell runs in the worktree.

Each entry goes in only when the variables that name it are set. A path that does not exist still goes in the list. The
`claude` program reads its own credentials outside the sandbox, so the list denies only the shell.

### The environment of the shell

The filter of the phases drops the GitHub token and the ssh agent of the user (see [phases.md](phases.md)). As a result,
the shell of the assistant has no GitHub token and no ssh agent of the user. The shell also cannot read the paths of the
[read deny list](#the-execute-role).

### The limits of the roles

- The network stays open.
- The assistant can read files that the lists do not name.
- The plan mode lets the assistant write its plan file under the configuration folder of `claude`, outside the worktree.

### The rules for the caller

- The caller must move the task into a spawning state before the run starts.
- The caller must record the session before the run starts.
- For the execute role, the caller must build the prompt with the commit text that the run gives, and must replace the
  base ref placeholder in it.
- For the execute role, the caller gives each start the time that is left of one deadline that covers every turn. A time
  of 0 or less goes to the run unchanged, so the caller must stop before it starts a turn with no time left.
- For the execute role, the caller must not start a second turn after a refused first start, because the start of a
  later turn continues the session.

## The claude-code provider

The provider runs Claude Code in print mode. It sends the prompt on stdin and reads one event from each line of stdout.
It makes no budget in money, because a money budget means nothing on a subscription.

### Arguments

`claude` refuses the streaming output format in print mode unless verbose output is on. The provider always turns it on.

Each tool rule goes as its own argument, so a rule with a space stays one rule. The host measure showed this. The two
tool lists take any number of values, so they come last. The prompt cannot follow them, and it goes to stdin.

In a test by hand on the local machine, write `--allowedTools=Bash`, and send the prompt on stdin or close stdin with
`< /dev/null`. A plain `claude -p --allowedTools Bash "<prompt>"` reads the prompt as a tool name (`claude` 2.1.300).

The schema goes inline as JSON text. `claude` parses the argument as JSON, and a file path fails on its first character.

A continued session also gets the model. A host measure showed that a resume with a model runs the given model.

One prepared run serves every turn of a session. The first start of a new session creates the session with
`--session-id`. Each later start continues it with `--resume`. A continued session uses `--resume` from the first start.
The flag changes when `start` is called, not when the run ends.

### Tool rules

These facts of `claude` give the reasons for some rules of the allow list of [the execute role](#the-execute-role).

The program `claude` answers `--json-schema` through a tool named `StructuredOutput`. A real capture showed a denial of
this tool under `dontAsk` without a rule. A measure on `claude` 2.1.300 showed no denial. The rule stays, so that both
cases work. The hook denies such a call in the `default` mode in the same way, so the rule is still needed.

The model calls the subagent tool `Agent`, and the `init` event of `claude` 2.1.300 lists it as `Task`. A measure on
2.1.300 showed that neither is denied without a rule. The list names both, because a later `claude` can use either name.

A skill points the model at reference files in the skills folder and the plugins folder of the configuration folder of
`claude`. The configuration folder is `CLAUDE_CONFIG_DIR`, or `.claude` under `HOME`. A measure on `claude` 2.1.300
showed that `dontAsk` denies the read of a skill file without a rule. In the `default` mode, the hook denies the same
call, so the rules stay. With the two rules, the read of a skill file and of a plugin skill file passes, and the read of
`settings.json` stays denied. The two rules name exactly the patterns `<configuration folder>/skills/**` and
`<configuration folder>/plugins/**`. Never allow the whole configuration folder, because it holds the credentials and
the settings. When neither variable is set, the list has no skill rule.

### The environment

The child gets the environment that [phases.md](phases.md) describes. This doc does not repeat the filter rules.

`CLAUDE_CONFIG_DIR` passes the filter on purpose. It locates the configuration of the child: its credentials, its trust
of folders and its settings. Without it, the child falls back to `$HOME/.claude.json`, not the folder that the user set.

A stray Anthropic key is a risk. With such a key, `claude` bills the API and not the subscription, and it gives no
error. The filter drops these keys for this reason.

### The stream

Each event is one JSON object on one line. A kill or a deadline can leave a cut last line. The provider drops a line
that does not parse and keeps the events before it.

The `init` event names the requested model, and this is not always the model that ran. A measure under the plan
permission mode showed the difference. Only `init` keeps the `[1m]` suffix of a long-context model. Subagent messages
and `<synthetic>` messages do not name the model of the main thread, so the provider skips them.

The model usage of the `result` event adds up each model of the session, also of earlier runs.

`claude` splits one API message into several `assistant` events with the same message id and the same usage. The output
count of these events is an early snapshot. As a result, only the `result` event gives exact totals. The result of a
continued run covers only that run.

Permission denials can come with the error flag set. A denied tool does not always end the run in an error.

### Sandbox

A run with a sandbox keeps the shell of the assistant inside limits. The shell can write only to the worktree, a temp
folder and the write paths of the caller. It cannot read the deny paths of the caller. The provider passes these limits
to `claude` as inline settings.

Each setting has a reason:

- `claude` must refuse to start when it cannot build the sandbox. A run with less confinement is the case that "refuse,
  never drop" forbids.
- A command must never leave the sandbox. The setting that allows this is off. The schema of `claude` says that a
  command which asks to leave the sandbox is then ignored, and tasker relies on that text. No host test ran this case.
- The write and deny paths are those of the caller, and the provider adds none.

The provider refuses a sandbox before it starts the program in three cases:

- The platform is not Linux or macOS.
- The platform is Linux, and `bwrap` or `socat` is not on the `PATH` of the child.
- The shared git folder of the worktree has a name that ends in `.git`. The reason is in
  [version-control.md](version-control.md#sandbox-write-paths).

On Linux, `bwrap` comes from the `bubblewrap` package, and `socat` has its own package. The setting that makes `claude`
fail when the sandbox is not available is the second guard, behind the check of the provider.

The only Unix socket that a command can use is the folder `claude-<uid>` in the temp root, as a real path. `claude`
keeps its own sockets there. The provider never opens all Unix sockets, because all Unix sockets include the sockets of
the ssh agent and the keyring. When this folder is a shared temp folder, or holds one, the provider gives no socket
rule. Then no command can use a Unix socket. When the provider cannot resolve the folder, the run fails before the
start, and the reason holds the error code and no path. macOS uses this rule. Linux ignores it, because `seccomp` cannot
filter by path.

The sandbox can always write the folder `claude-<uid>` in the temp root (`/tmp/claude-<uid>`). So a test of the sandbox
on the local machine runs outside that folder (`claude` 2.1.300).

The sandbox leaves placeholder files in the worktree. `bwrap` makes an empty read-only file for each protected path that
does not exist, for example `.bashrc`, `.mcp.json` and some entries of `.claude/`. A killed `claude` does not clean
them, and a normal exit still leaves `.claude/.cc-writes` and `.claude`. Measures on `claude` 2.1.289 and 2.1.299 gave
the same lists.

After each sandboxed run that reached the start, the provider removes these placeholders. It removes a path only when
git does not track it and the path is an empty file with a read-only mode and one link, or an empty folder. The cleanup
follows no symlink, also not in a parent folder. When `.claude` is a symlink, the cleanup leaves it and each entry of
its target. A file with data and any other name stay. The outcome lists the removed paths, or the error. The cleanup
never changes the kind of the outcome. A refused run starts nothing, so it has no cleanup.

The limits of the sandbox:

- The network stays open to all domains, because the assistant must reach its own service and the package hosts.
- Only the shell of the assistant is in the sandbox. The `claude` program is not.
- A shell command can write `objects/`, `refs/` and `logs/` of the clone, because `git commit` needs them. See the known
  limit in [version-control.md](version-control.md#sandbox-write-paths).
- In the bare clone of a live sandboxed execute run, `claude` 2.1.310 shows no `config.lock`, but `claude` 2.1.284 to
  2.1.289 can hold one.
- After a kill of `claude` 2.1.310, the bare clone keeps no `config.lock`, `.mcp.json` or `.claude/` folder, but
  `claude` 2.1.299 left them there.
- A later `claude` can widen the write list in a way that the guard of the `.git` name does not catch. The guard follows
  `claude` 2.1.299.

### Quota

When a rate limit stops a run, the last event is a `result` with `terminal_reason: "api_error"` and
`api_error_status: 429`. `claude` exits with a code other than 0. The `subtype` and `stop_reason` of that result say
`"success"` and `"stop_sequence"`. These values are decoys, so the provider does not read them. The text of the last
turn gives the reset in local time with no date, so the provider does not read it either. The reset time comes from the
rejected rate-limit event.

A quota outcome wins over a failure, because the next step is a resume, not a fix.

[The outcome of an interrupted run](#the-outcome-of-an-interrupted-run) gives the order of a quota outcome, the
interrupted outcome, a failure and a timeout.

The provider says which events are quota events, because only the provider can read its own stream. During each run,
tasker records the last quota event of the repo. The record comes after the transcript write, so a failed record write
cannot drop a transcript line. [The `quota_events` table](data-root.md#quota_events-table) holds the record.

Paid usage (overage) is usage past the subscription quota, and it costs money. The caller must pass the overage stop
only under `overagePolicy: "decline"`. The caller must pass the reset time of the window that the user approved. An
event in that window does not stop the run. An overage stop ends the child at once. Its outcome wins over the timeout,
because it rests on the parsed event, not on whether the stop beat the exit of the child.

The approved window of the task is the reset time of the last approval of the task. The caller passes it to each run
under each policy. Each policy has one kind of pause and one compare with the approved window:

- Under `decline`, the pause is `quota_blocked` at the start of paid usage.
- Under `ask`, the pause is `awaiting_quota_approval` after a run whose use of the quota window reaches
  `quotaApprovalThreshold`. The caller asks the provider for the warning, then asks whether the approved window
  suppresses it. The caller does not read the events itself.

An event shows the start of paid usage when `isUsingOverage` is `true`, or when `status` is `rejected` and
`overageStatus` is `allowed` or `allowed_warning`. In the second case, the subscription is spent and paid usage is on. A
high `utilization` alone does not show it. The presence of `overageStatus` does not show it, and neither does
`overageStatus: "rejected"`, because an `allowed` event can carry `overageStatus` too. With paid usage off, the stop
comes through the quota stop.

An approval stores the `resetsAt` of the pause record. The approved window is then the window of the pause.

The events have these facts:

- Under `rateLimitType: "overage"`, the flat use and reset time describe the cap of paid usage, not the spend of the
  subscription. A capture showed `utilization: 0.99` there while `isUsingOverage` was `false`.
- Under `rateLimitType: "overage"`, the relevant window and the spent window can differ.
- Each policy compares its own window with the approved window. Under `decline`, it is the spent window. Under `ask`, it
  is the window of the warning.
- `unifiedWindows` is missing in older captures. A real `allowed` event has no flat use, so the entry of the window must
  win.
- The last warning window counts, not the highest. A run can pass into a new window, and the high use of the old window
  must not hide the new one.
- A warning with no reset time never matches an approval, so the pause comes again.
- A field can be missing or not a number. A bad event never throws.

### Limits

Tasker keeps the events itself, so the provider has no transcript path.

No real capture shows the start of paid usage. This rule of the start of paid usage is the best known form. The stream
can report paid usage only after the first paid request, so one paid request can pass before the stop.

### Doctor checks

The version check is required. It runs once for all repos of the provider. On Linux, two more required checks make sure
that `bwrap` and `socat` are on `PATH`. Each missing program (`claude`, `bwrap` or `socat`) gets the fix to install it,
because only an install fixes that cause. Other causes, such as a failed run of the program, get no fix.

The model check of a continued session uses the model forms of the configuration. It holds no second rule.

## The codex provider

The provider lets a repo name `codex` in `assistant.provider`. It runs each role, and it gives the doctor checks of
Codex. It starts `codex exec`, or `codex exec resume` for a continued session. It reads the JSON events from stdout. The
prompt goes on stdin, and the last argument is `-`. A run with `access` of `"workspace-write"` (the execute role) gets
write keys and a hook. A run with `access` of `"read-only"` gets neither.

The hooks of the user run in each execute run. The argument `--dangerously-bypass-hook-trust` runs them, also under
`--ignore-user-config`. The provider adds no way around this.

### The arguments

`codexArgs()` in `src/assistant/codex/args.ts` builds the list. The same `-c` values go to a new session and to a
continued session.

- `--ignore-user-config` and `--ignore-rules` leave out the configuration and the rules of the user and of the worktree.
  They do not leave out the hooks of the user (see "Measures and limits"). A `.codex/config.toml` in the worktree loads
  without `--ignore-user-config`.
- `-c approval_policy="never"`: the run asks no question, because nobody answers.
- `-c web_search="disabled"` alone does not turn off web search, because the model can still search through an MCP tool.
  Together with `-c features.apps=false` it does.
- `-c default_permissions="tasker"` names a permission profile that the run defines with
  `-c permissions.tasker.filesystem={...}`. The table grants read of `"/"`. A smaller grant makes each command fail.
  `filesystemTable()` builds the table in a `Map`, so a path has one key. The key is `JSON.stringify(path)`, so a dot, a
  space or a quote stays in one key.
- Under `workspace-write`, the cwd, the temp folder and each path of `sandbox.allowWrite` are keys with the value
  `"write"`. The temp folder is `TMPDIR`, or `/tmp` when `TMPDIR` is not set. A `read-only` run has no write key and
  does not read `sandbox.allowWrite`.
- Each path of `sandbox.denyRead` is a key with the value `"deny"`. So are the folder `herdr` under `XDG_CONFIG_HOME`
  (or under `HOME/.config`), the real path of the file that `SSH_AUTH_SOCK` names, the real path of the folder that
  `XDG_RUNTIME_DIR` names and the real path of `/var/run/docker.sock`. `codexSocketDenyPaths()` in
  `src/assistant/codex/sockets.ts` gives the socket paths for every role, from the env before the child filter. It
  leaves out `SSH_AUTH_SOCK` when its real path cannot be read. It leaves out the runtime folder or Docker socket when
  its path is missing or passes through a non-directory. Another real-path error fails the run before spawn. A deny key
  under a write key holds.
- Two facts of the table hold for every key. A key must not be a symbolic link, because the run then fails at the start.
  So a link becomes its target, and a link that cannot resolve is left out. Both lists use real paths, with a link
  resolved in every part. An existing path under another deny key must not be a key, because the run then fails at the
  start. So the table leaves it out. A deny path wins over a write path. A write key that is on or under a deny path is
  dropped. A deny key under a write key stays. A path that does not exist stays.
- Under `workspace-write`, `-c hooks.PreToolUse=[...]` and `--dangerously-bypass-hook-trust` follow the network line.
  `codexHookArgs()` builds them. The matcher is `^apply_patch$`, the command is a TOML string, and the timeout is 10
  seconds. A continued session gets the same arguments.
- `-c permissions.tasker.network.enabled=true`: without it, a command cannot resolve a host.
- Never use `-s`, `--sandbox` or `sandbox_mode`, because a profile does not compose with them. Never use `--ephemeral`,
  because an ephemeral session cannot be continued.

### The values of a session

Codex gives the thread id in the `thread.started` event. A continued run needs it. tasker stores the id in
`provider_session_id` of the `sessions` table. A continued run with no id gets a `failure` outcome before the spawn. A
failed write does not stop the run.

The `usage` of `turn.completed` is a total for the whole thread, not for the run. tasker stores the last total in the
`usage_total_` columns of the `sessions` table. The usage of a run is the total of the run minus the stored total, never
below 0. NULL counts as zero. A run with no `turn.completed` gives `"unavailable"` and leaves these columns as they are.
A failed write does not stop the run, and the next run then counts too much.

`input_tokens` includes the cached tokens, so `inputTokens` is `input_tokens` minus `cached_input_tokens`.
`output_tokens` includes the reasoning tokens.

The provider keeps `<sessionId>.schema.json` under `sessionDir`, with `jsonSchema` for `--output-schema`. Its path comes
from `src/store/layout.ts`.

### The outcome

The rules differ from `claude-code` in these points.

- There is no quota outcome. `overageStop` has no effect.
- A top-level `error` or `turn.failed` event gives a `failure` outcome with its message. An `item.completed` event with
  item type `error` is a warning, and the reader ignores it.
- `permissionDenials` is always `[]`. A command that the sandbox blocks is a normal `command_execution` item with the
  shell error in `aggregated_output`.

A `read-only` run sets no `sandboxCleanup`. A `workspace-write` run can leave the empty folders `.agents`, `.aws` and
`.codex` in the worktree. The sandbox makes them as mount points during the run, and it does not always remove them.
After each run that reached the spawn step, also after a kill or a failure, the provider removes them with
`removePlaceholders()`. `absentPlaceholders()` in `src/assistant/codex/placeholders.ts` names only the folders that did
not exist before the spawn. A folder with an entry, a file and a link stay. A failed removal gives an `error` in
`sandboxCleanup` and never changes the kind of the outcome.

A deny of the hook adds no event, so `permissionDenials` stays `[]`.

### What the sandbox blocks and what stays open

No `-c` key and no flag gives one run a `forbidden` rule. A rules file loads only from the Codex home of the user or
from a trusted worktree, and `--ignore-user-config` drops the trust. `--ignore-rules` drops each rule. So the task
subagent tested no form that passes a rule, because no rule exists. The sandbox is the only limit on `deniedCommands`,
and it does not block every entry.

A command can connect to each Unix socket at a path that no deny key covers, because the network is on. So the table
denies the herdr folder, the file of `SSH_AUTH_SOCK`, the folder of `XDG_RUNTIME_DIR` and the Docker socket in every
role. The Docker socket gives root on the host to each member of the group `docker`. The folder of `XDG_RUNTIME_DIR`
holds the session bus. On a desktop host, it also holds other sockets of the user, for example of the keyring. A tool of
a run that needs one of these sockets fails, for example `systemctl --user`.

These sockets stay open: an abstract socket, a socket at another path, and a herdr socket at a custom path
(`HERDR_SOCKET_PATH` outside the default folder). Examples of another path are a socket that `DOCKER_HOST` names, a bus
outside `XDG_RUNTIME_DIR` and an ssh agent that `SSH_AUTH_SOCK` does not name. `/run/user/<uid>` for a run with no
`XDG_RUNTIME_DIR` is another example. A later issue adds a seccomp filter that blocks them.

The sandbox blocks each path of `denyRead`. In a `read-only` run it blocks each write. In an execute run it blocks each
write outside the write keys. A `TMPDIR` under `XDG_RUNTIME_DIR` gets no write key, because a deny path wins.

`git push` over https, or over ssh with a key file, stays open, because the network is open. A run of `codex` in the
plan, refine and review roles has layer 2 and layer 3 of the push guard, and no layer 1. An execute run has the same
layers. See [Push guard](version-control.md#push-guard).

### The limits of the execute role

The execute role writes the worktree, the temp folder and each path of `sandbox.allowWrite`. The sandbox protects
`<worktree>/.git`, `.codex`, `.agents` and `.aws` by itself. A repo that tracks a file under `.codex/` or `.agents/`
cannot edit it in an execute run.

The sandbox cannot tell `apply_patch` from a `git commit`, because both run as the same run. A `git commit` must write
under `<clone>/refs`, `objects`, `logs` and `worktrees/<name>`, so these are write paths. As a result, `apply_patch` can
add a file there too. A `PreToolUse` hook of tasker closes this gap for `apply_patch`. It gets `deniedEditPaths`
(`<worktree>/.git`, `<worktree>/.git/**` and `<clone>/**`).

`src/assistant/codex/edit-hook-main.ts` runs as `node edit-hook-main.js <worktree> <denied...>`. It reads the stdin of
the hook, and `editHookAnswer()` decides. A deny is one line of JSON with exit code 0. An allow prints nothing. The hook
reads each `*** Add File:`, `*** Update File:`, `*** Delete File:` and `*** Move to:` header. It denies a patch that it
cannot read, a path with a `..` part, a denied path, a symbolic link in the path, a path that it cannot read and a path
outside the worktree. It writes no file. An indented `***` line that matches no header is a context line of a hunk. A
`***` line with no indent that matches no header is a patch that the hook cannot read.

The hook denies an `apply_patch` path outside the worktree that no entry names. This is a decision that the issue did
not state. The reason is the limit of the `claude` provider, which allows `Edit` and `Write` only in the worktree. The
shell can still write the temp folder.

Codex lets the patch pass when the hook fails. A crash, output that is not JSON, a timeout and a `command` that names a
missing file all allow the patch. Three guards follow. The main script runs everything in one `try`, loads the hook with
a dynamic `import()`, and prints a literal deny line in the `catch`. The provider makes sure that the script is a file
before the spawn, and gives a `failure` outcome if not. The timeout is 10 seconds, and the hook is fast. A timeout of
the hook allows the patch.

| Limit                 | `claude-code`                          | `codex`                                                                     |
| --------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| Edit of a denied path | The deny rules of the edit tools       | The hook, for `apply_patch` only                                            |
| `deniedCommands`      | Deny rules (layer 1 of the push guard) | No rule. The sandbox is the only limit                                      |
| Denied edit           | An entry in `permissionDenials`        | No event. `permissionDenials` is `[]`                                       |
| Hooks of the user     | The provider passes no flag for them   | Run, because of `--dangerously-bypass-hook-trust`                           |
| Cleanup               | The placeholders of the sandbox        | The empty folders `.agents`, `.aws` and `.codex` that the sandbox can leave |

### The doctor checks

`doctorChecks()` gives the checks `codex version` and `codex login`. They run once for all repos of the provider.
`codex version` makes sure that `codex` is on `PATH` and starts. `codex login` makes sure that `codex` has a login.

The task subagent measured `codex login status` on `codex-cli 0.166.0` on 2026-10-31. With a login, the exit code was 0.
With an empty folder as `CODEX_HOME`, the exit code was 1 and stderr was `Not logged in`.

`CODEX_HOME` passes [the filter](phases.md#the-environment-of-a-phase) on purpose. It locates the credentials and the
configuration of the child.

### Measures and limits

Each measure below ran on `codex-cli 0.166.0` on 2026-10-31, unless it names another date. All measures ran on Linux. A
run on macOS or Windows is unmeasured.

- Prompt: `codex exec -` and `codex exec resume <id> -` read the prompt from stdin.
- Session id: the `thread.started` event gives `thread_id`. `codex exec resume <thread_id>` continues the session and
  prints the same id.
- Flags of a continued session: `codex exec resume` takes `--json`, `-m`, `-c`, `--ignore-user-config`, `--ignore-rules`
  and `--output-schema`. It takes no `-s`.
- Structured answer: the answer is the text of the `item.completed` event whose item type is `agent_message`. The plan
  schema and the review schema pass unchanged, because no key is optional (#681). A schema with an optional key fails
  with `invalid_json_schema`.
- Structured answer in a continued session: `codex exec resume` takes `--output-schema`, and the answer follows the
  schema.
- Effort: `low`, `medium`, `high` and `xhigh` work through `-c model_reasoning_effort`. Codex does not refuse another
  value at the start. The model call fails, with an `error` event and a `turn.failed` event, and the exit code is 1.
- One permission profile: the `-c` values of "The arguments" define a profile with no file of the Codex home. A write of
  a command fails with `Read-only file system`. A profile that grants read to less than `"/"` makes each command fail.
- Read deny: a path of `denyRead` gives `Permission denied` for a file and for a folder, also with a dot, a space or a
  quote in the name. A path that does not exist is no error. The login still works with `auth.json` on the list.
- Network: a command reaches the network only with `permissions.tasker.network.enabled=true`.
- Denied command: no `-c` key and no flag gives one run a `forbidden` rule. A rules file loaded only from a trusted
  worktree, and it held under `approval_policy="never"`. `--ignore-user-config` and `--ignore-rules` each drop it.
- Blocked command in the stream: a command that a `forbidden` rule refuses gives no event, only an error line on stderr.
  A command that the sandbox blocks is a normal `command_execution` item. A failed model call gives an `error` event and
  a `turn.failed` event, and the exit code is 1.
- Other rules: a rules file in a trusted worktree loads without the two flags. `--ignore-rules` drops it.
- Usage: `input_tokens` includes `cached_input_tokens`, and `output_tokens` includes the reasoning tokens.
  `turn.completed` gives a total for the whole thread.
- herdr (2026-11-01): with the network on, `herdr agent list` and `sh -c 'herdr agent list'` work, also with only
  `"/"="read"` in the table. With the network off they fail with `Operation not permitted`. With a deny key for
  `<home>/.config/herdr`, both fail with `Permission denied`, and the run still finishes.
- ssh agent (2026-11-01): with the network on, `ssh-add -l` and a connect to `SSH_AUTH_SOCK` work. With a deny key for
  the real path of the socket, both fail with `Permission denied`.
- Runtime folder and Docker (2026-11-04): with the network on and only `"/"="read"`, a connect to
  `$XDG_RUNTIME_DIR/bus`, to `/var/run/docker.sock` and to `/run/docker.sock` works. With deny keys for the real paths
  of `XDG_RUNTIME_DIR` and of `/var/run/docker.sock`, each connect fails with `Permission denied`. A connect to an
  abstract socket still works.

  On 2026-11-05, `codexArgs()` with this branch and the host env built a `read-only` table with deny keys
  `/home/codeguru/.config/herdr`, `/run/user/30033` and `/run/docker.sock`. With that table and the network on,
  `codex sandbox` returned `EACCES Permission denied` for connects to `/run/user/30033/bus`, `/var/run/docker.sock` and
  `/run/docker.sock`. One real `codex exec` with the final `read-only` arguments exited 0 and gave `thread.started` and
  `turn.completed`.

- Keys of the table (2026-11-01): a key that is a symbolic link makes the start fail with
  `bwrap: Can't mount on symlink destination`. An existing path under a denied folder makes the start fail with
  `bwrap: Can't create file ...: Read-only file system`. A missing path under a denied folder is fine. A deny key under
  a write key holds. A write key under a deny key reopens the path: the run started, and a write to it worked. The
  provider never builds such a table: it drops the write key.
- Write profile (2026-11-01): plain keys with `write` for the worktree, the temp folder and the clone paths give the
  same results as `extends=":workspace"`. `git commit` works in a linked worktree of a bare clone, and `<clone>/logs`
  must exist. The line about `packed-refs.lock` on stderr is known.
- Edit of denied paths (2026-11-01): `apply_patch` cannot change `<worktree>/.git`, `<clone>/description` or
  `<clone>/hooks/*`. It can add files under `<clone>/refs`, `objects`, `logs` and `worktrees/<name>`. A patch path
  `sub/../x.txt` writes `x.txt`. The shell has no `apply_patch`.
- Config folders (2026-11-01): `apply_patch` and the shell cannot write `<worktree>/.codex/` and `<worktree>/.agents/`.
- Hook (2026-11-01): the inline `-c hooks.PreToolUse=[...]` form needs no file in the Codex home. It runs only with
  `--dangerously-bypass-hook-trust`, in `codex exec` and in `codex exec resume`. `tool_name` is `apply_patch`, and
  `tool_input.command` holds the bare patch text. A deny line with exit 0, or exit 2 with the reason on stderr, blocks
  the call. A crash, output that is not JSON, a timeout and a missing script allow the patch. The unit of the hook
  timeout is seconds: a hook with `timeout=2` that sleeps 15 seconds let the patch pass, and the real hook with
  `timeout=10` ran in about a second and denied the patch. The flag adds two `error` items to the stream, and the reader
  ignores them.
- Hooks of the user (2026-11-01): the hook in `~/.codex/hooks.json` does not run under `--ignore-user-config`. With
  `--dangerously-bypass-hook-trust` it runs.
- Hooks of the repo (2026-11-01): a `.codex/hooks.json` of an untrusted worktree did not run, also with
  `--dangerously-bypass-hook-trust` and `--ignore-user-config`. A trusted worktree is unmeasured.
- Placeholders: a `read-only` run leaves no file in the worktree, after a normal exit and after SIGKILL. A write run
  (2026-11-01) makes the empty folders `.agents`, `.aws` and `.codex` during the run, and they stayed after the run in
  some runs and not in others. In a real provider run, the cleanup removed the folders that were still there after the
  run, and `sandboxCleanup.removed` listed them. The state after SIGKILL is unmeasured.
- bwrap: not measured. The run cannot make the sandbox fail on the test host.
- Other tools: web search stays on through an MCP tool unless `features.apps=false` is set. `--ignore-user-config`
  leaves out the MCP servers of the user.
- Configuration: `--ignore-user-config` leaves out `config.toml` of the user. A `.codex/config.toml` of a trusted
  worktree loads without the flag and not with it. Hooks did not run in `codex exec` without
  `--dangerously-bypass-hook-trust`.

Some measures are weaker. The measures of the profile, of the rules and of the configuration ran on the real Codex home
of the user. A rules file of the user is not proven to load, because none existed. `--ignore-rules` rests on its help
text. Nobody measured a host where the sandbox cannot start. Nobody measured a hook of a trusted worktree.

- `overageStop` has no effect.
- A hook that crashes, times out or names a missing file lets the patch pass. The guards of "The limits of the execute
  role" reduce this.
- A tool path that skips the hook skips `deniedEditPaths`. The sandbox still limits it to the write paths.
- An abstract socket and a socket at a path that no deny key covers stay open to a command.
- macOS and Windows are unmeasured.
- A sandboxed command can outlive a SIGKILL of `codex`.

## The pi provider

After each upgrade of `pi`, a person measures these facts again, because no test shows a change of them. Later tickets
add their items to this list:

- The output of `pi list --no-approve`.
- The output and the exit codes of `pi auth check --json`.
- The skill folders of the user that `pi` reads.
- The forms of a package source, and the rule that `pi update` does not move a configured ref.
- The rule of the agent folder of `pi`, which `piAgentDir()` and `piAgentDirs()` copy.
- The model form `provider/id` and the thinking levels of `--model` and `--thinking`.
- The built-in extension keys, tool sources, `-builtin:<name>` entries and `--no-mcp` behavior.
- The sources of the extensions of the agent folder and the form of the key of each source.
- The source and path of tools loaded with `-e`, including tool replacement.
- The path forms, Unicode-space handling, read variants and default paths of pi file tools.
- Project file loading under `--no-approve` and relative imports from a built extension loaded with `-e`.

### The agent folder

The agent folder of `pi` holds its credentials, its `settings.json` and its extensions. `pi` takes the folder from
`PI_CODING_AGENT_DIR`, else from `.pi/agent` under the home folder. It expands a value of `~` or `~/...` with the home
folder. It converts a `file://` URL to a path. It uses a relative value as it stands. A measure on `pi` 1.1.0 on
2026-11-03 showed these facts.

`piAgentDir()` in `src/assistant/config-folders.ts` is the one home of the agent folder in tasker. It reads
`TASKER_PI_CODING_AGENT_DIR`, and it follows the rules of `pi` for the value, with three differences. A blank value
counts as unset, as for each other variable of tasker. If `HOME` is not set, an unset value or a value that starts with
`~` gives no folder. The reason: tasker never takes the home folder of the host from the system, but `pi` does when
`HOME` is unset. For a `file://` URL that `pi` cannot convert, it gives the value as it stands, where `pi` throws.

The read deny list holds three files of the agent folder: `auth.json`, `mcp-auth.json` and `models.json`. `auth.json`
holds the saved API keys and OAuth credentials of `pi`. `mcp-auth.json` holds the OAuth tokens of its MCP servers.
`models.json` can hold an API key of an endpoint as plain text. The shell and the read tools of a run need none of the
three files.

The list holds the three files in up to three folders: the folder of `TASKER_PI_CODING_AGENT_DIR`, the folder of
`PI_CODING_AGENT_DIR` and `.pi/agent` under `HOME`. `piAgentDirs()` gives these folders, with the rules of
`piAgentDir()` for each value. The first folder is the agent folder of the `pi` of tasker. The other two are agent
folders that a `pi` of the user can use. Without `TASKER_PI_CODING_AGENT_DIR`, `.pi/agent` under `HOME` is also the
agent folder of the `pi` of tasker. Tasker passes no `PI_CODING_AGENT_DIR` of its own environment to a `pi` child.

`TASKER_PI_CODING_AGENT_DIR` and `TASKER_PI_CODING_AGENT_SESSION_DIR` are the two inputs of tasker for the agent folder
and the session folder of `pi`. The filter of the phases drops each name that starts with `TASKER_`, so no child gets
them. This follows `TASKER_GH_CONFIG_DIR`, which the forge child gets as `GH_CONFIG_DIR`. The pi provider must pass the
two values to its child as `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`, in the form that `pi` expects.
Without `PI_CODING_AGENT_DIR`, the child uses `$HOME/.pi/agent`, not the folder that the user set.
`PI_CODING_AGENT_SESSION_DIR` locates the sessions of a `pi` command that names no `--session-dir`.

A run of the pi provider and each doctor check that starts `pi` refuse a `TASKER_PI_CODING_AGENT_DIR` that is set and
not absolute, before `pi` starts. The rule also refuses `~`, `~/...` and a `file://` URL, so that each `TASKER_` folder
name has one check and one text. The reason: `pi` uses a relative value as it stands, and the file that it opens follows
the cwd of the `pi` process. The deny path of tasker is absolute, so the two can name different files. The deny list
adds no pi entry for a folder that is not absolute, and it never refuses a run of another provider. Nobody measured a
full run of `pi` in a sandbox, or the cwd that tasker gives a `pi` child.

With no `TASKER_PI_CODING_AGENT_DIR`, a run of the pi provider and each doctor check that starts `pi` also refuse a set
`HOME` that is not absolute. The reason: the agent folder is then `.pi/agent` under `HOME`, so a relative `HOME` gives a
relative agent folder. The deny list holds no pi entry for a relative folder, so `piChildEnv()` refuses such a folder
and does not make it absolute. A set `TASKER_PI_CODING_AGENT_DIR` names the agent folder of the `pi` of tasker. A
relative `HOME` then gives no deny entry for `.pi/agent` under `HOME`, and none for a `PI_CODING_AGENT_DIR` of `~` or
`~/...`.

### The program

The variable `TASKER_PI_BIN` names the `pi` program. For the rule of the resolve, see
[TASKER_ACLI_BIN](jira.md#tasker_acli_bin) in `docs/dev/jira.md`.

### The environment of a pi child

Each `pi` child gets the agent folder as `PI_CODING_AGENT_DIR`. `piChildEnv()` gives a reason in three cases, in this
order. First, `TASKER_PI_CODING_AGENT_DIR` is set and not absolute. Second, it is not set, and `HOME` is set and not
absolute. Third, `piAgentDir()` gives no folder. [The agent folder](#the-agent-folder) gives the reason for the first
and second cases. On a reason, a run refuses before the spawn, and each doctor check that starts `pi` fails.

### The model forms

tasker splits a `pi` model at its first `/`. The part before it is the upstream. The upstream is the model service that
`pi` calls and that bills the task. The part after it is the model id.

### The doctor checks of pi

The checks run in this order: `pi version`, one `pi-auth:<upstream>` for each upstream, `superpowers:pi` and
`simple-english:pi`. `pi version` makes sure that `pi` runs. `pi-auth:<upstream>` makes sure that `pi` has a login for
the upstream. `superpowers:pi` makes sure that the superpowers package is installed and is version 6.4.1 or later.
`simple-english:pi` makes sure that the skill `simple-english` is in a skill folder of the user.

A task subagent measured these facts on 2026-11-07 with `pi` 1.1.0 on Linux. No measure called a model.

- `pi --version` printed `1.1.0`.
- `pi auth check --provider openrouter --json --no-refresh` with a login exited 0 and printed
  `{"status":"ready","provider":"openrouter","authType":"oauth"}`.
- The same command for `nosuchprov` exited 1 and printed
  `{"status":"not_ready","provider":"nosuchprov","reason":"provider_not_found"}`.
- The same command for `openrouter` with an empty folder as `PI_CODING_AGENT_DIR` and no variable that ends in
  `_API_KEY` exited 1 and printed
  `{"status":"not_ready","provider":"openrouter","reason":"credentials_not_configured"}`.
- `pi list --no-approve` with an empty folder as `PI_CODING_AGENT_DIR` exited 0 and printed `No packages installed.`.
- `pi list --no-approve` with a package of the user printed `User packages:`, a line with two spaces and the source, and
  a line with four spaces and the path.

The reasons for the checks:

- The timeout of `pi-auth:<upstream>` allows a refresh of an OAuth login over the network.
- `--credentials` prints the secret.
- With no `--no-refresh`, the check gives the same answer as a run.
- `pi update` does not move a configured ref and keeps the range of an `npm:` source, so the remediation also names
  `pi install`.
- `pi` loads a skill of the worktree only with the trust of the project, and each run of tasker refuses that trust. So
  `simple-english:pi` does not look there.

### The guard extension

The guard extension checks each tool call before the tool runs. It defines limits for a pi run. The pi provider does not
load it yet.

The guard trusts a tool only when its name and source match the limits file and pi still reports that source. It checks
the current source on each call, including a call made through `ctx.executeTool()`.

The fields and their meanings are in [guard-limits.ts](../../src/assistant/pi/guard-limits.ts). The path checks run in
the order shown in [guard-extension.ts](../../src/assistant/pi/guard-extension.ts). They resolve real paths through
[real-path.ts](../../src/real-path.ts). The guard compares supplied paths and real paths. A deny path takes priority
over an allowed root.

Before valid limits exist, each tool call blocks. An unreadable or invalid limits file stops pi before its first
provider request. A tool-handler error blocks the call with a fixed reason. A skill-handler error removes all skill
folders supplied by pi.

`skillRoots` adds read roots only when `readRoots` is a list. The guard drops a skill root on, under or above a
protected or denied path. Missing roots grant no access. The guard blocks shell tools.

The guard has one limit. A later extension can change a call's input after the guard passes it. Pi loads extensions
named with `-e` first. The limit applies to each extension that pi loads after the guard.

A task subagent measured facts 1–11 on 2026-11-07 with pi 1.1.0 on Linux. Each run used a new scratch folder, a scratch
home folder and an empty `PI_CODING_AGENT_DIR`. Each run set `PI_TELEMETRY=0` and used `-p --mode json --offline`, a
faux provider and no real model.

1. Pi loaded these built-in extensions by default: `builtin:llama.cpp`, `builtin:mcp`, `builtin:codemode` and
   `builtin:tool-search`. The commands `llama` and `mcp` came from `builtin:llama.cpp` and `builtin:mcp`. The tools
   `codemode` and `tool_search` came from `builtin:codemode` and `builtin:tool-search`. An unknown built-in extension
   made pi exit with code 1. The tools `codemode` and `tool_search` reported source `builtin`.
2. A `-builtin:<name>` entry in the extensions list of the agent configuration stopped each of those built-in extensions
   from loading.
3. `--no-mcp` stopped `builtin:mcp`, including when the command also named `-e builtin:mcp`.
4. Built-in tools reported source `builtin` and paths `builtin:<tool name>`. Tools from a file named with `-e` reported
   source `cli` and that file's absolute path. No built-in extension tool shared a built-in tool's name. By default, pi
   enabled `read`, `bash`, `edit` and `write`. The tools `grep`, `find` and `ls` needed `--tools`.
5. A tool from an extension named with `-e` replaced the built-in `read`. `pi.getAllTools()` reported the source of the
   replacement tool, and that tool ran.
6. A factory error made pi exit with code 1 before the faux provider received a request. The error text appeared on
   stderr, so factory errors must not include limits-file values.
7. The factory saw `--tasker-guard-limits` and its path as separate `process.argv` entries. The
   `--tasker-guard-limits=<path>` form was one entry and failed validation. `pi.getFlag()` had no value during factory
   load; `session_start` had the path.
8. A `before_agent_start` event gave each skill's `filePath`, `baseDir` and `sourceInfo`.
9. Pi dropped one leading `@`: `@at.txt` opened `at.txt`, and `@@at.txt` opened `@at.txt`. It expanded `~` and `~/`. It
   converted lowercase `file://` paths and decoded `%20`. `file://localhost` worked.

   A file URL with another host failed. Pi treated uppercase `FILE://` as a relative path. It changed U+00A0, U+202F and
   U+3000 to plain spaces. A file with U+00A0 in its name did not open from a path with U+00A0.

   For a missing `read` path, pi tried the narrow no-break space in ` AM.` and ` PM.` matches, NFD, right apostrophes,
   and NFD with right apostrophes. The case of `AM` or `PM` stayed the same, and pi did not try NFC. `read` without a
   path failed before the guard event. `grep`, `find` and `ls` without a path used the worktree.

10. The project held `.pi/extensions/probe.ts` and `.pi` configuration entries `../pe.ts`, `+builtin:mcp` and package
    `../pkg`. The user configuration disabled `builtin:mcp`. Under `--no-approve`, nothing from the project loaded, and
    `builtin:mcp` stayed off. With `--approve`, the three project extensions ran and `builtin:mcp` loaded. An earlier
    try used `./pe.ts` and `./pkg`; they resolved against `.pi` and did not load.
11. A built extension loaded with `-e` imported a relative module from a scratch built-file layout and `node:fs`. Pi ran
    its factory, and the imported function returned its value. Pi exited with code 0. This measure did not use tasker's
    actual `dist/` folder.

The reasons for the guard rules:

- An extension can register a tool with the name of a built-in tool, and it can do this during a run. So the guard
  extension finds the source of the tool again on each call.
- `--no-mcp` turns off the built-in MCP support of `pi`, so no server of `mcp.json` connects. Such a server can start a
  process outside the limits of tasker.
- For a missing `read` path, `pi` opens a variant of the path. So the guard extension tests each variant.
- `pi` changes a Unicode space to a plain space, so the text of the path and the opened file can disagree.
- A write through a dangling symbolic link makes a file where the link points.
- The guard extension reads `process.argv`, because `pi` gives the value of an extension flag only after the load.
- `/proc` shows the environment, the command line and the open files of the `pi` process and of the other processes of
  the user. The read deny list cannot name each such path.

### The precheck of extensions

The keys of each source and the exact-match rule are in [`trustedExtensions`](../config.md#assistant). The trust list of
a continued session follows [New and continued sessions](#new-and-continued-sessions).

An `extensions` entry that starts with `-` or `!` gives no key. Only `-builtin:<name>` removes a removable built-in key.
A `builtin:<name>` or `+builtin:<name>` entry keeps its key, also when the list has `-builtin:<name>`. A missing
`settings.json` or `extensions/` folder gives no entry.

The precheck refuses when it cannot find a real path of the agent folder or worktree. It refuses an agent folder whose
real path is in the worktree. It also refuses an unreadable or invalid `settings.json`, invalid `extensions` or
`packages`, or an extensions folder it cannot list. [The code](../../src/assistant/pi/extensions.ts) gives the text and
order of each reason.

A user extension loads after the guard extension. Its `tool_call` handler runs after the handler of
[the guard extension](#the-guard-extension). `--no-approve` covers only the resources of the worktree, not the
extensions of the agent folder.

An unreadable source can still hold an extension that `pi` loads. A parse error can quote a secret of the file. An exact
match cannot trust more than the user named. A removed entry of the configuration must not break a session that is under
way.

The precheck masks the user part of a URL when it prints a key. The URL of a package source can hold a token. The column
`sessions.trusted_extensions` stores each key unmasked. The same text already stands in the `settings.json` of pi, which
a run can read.

A built-in extension runs code in the `pi` process, as a user extension does. For example, a script of `codemode` calls
the other tools of `pi`. It also runs "non-LLM models, such as classifiers and image models", as `docs/codemode.md` of
`pi` says. So a built-in extension needs trust too.

The precheck must find too many extensions, never too few. So each entry of the folder `extensions/` counts. Each run
gets `--no-mcp`, so the list has no default key `builtin:mcp`. The entry `-builtin:<name>` removes a key only where
[the guard-extension measure](#the-guard-extension) records that it stops that built-in extension.

An agent folder in the worktree holds files that come from the repo, and a run in the execute role can change them. So
such an agent folder refuses each run.

## The plan answer and the prompts

### The untrusted tag

An untrusted value, such as the text of an issue, stands in its own tag in the prompt. The tag lets the assistant tell
data from instructions. A third party wrote the value, so the value cannot give orders.

The fill makes the closing tag of that tag harmless inside the value. Without this step, the value ends the block early
and puts its own instructions after it.

The plan and the feedback of a refine run also stand in a tag, and the fill treats them in the same way. They are not
text of a third party, but the tag keeps each block clear.

The open questions of a refine run also stand in an untrusted tag. The plan session writes them after it reads the issue
text of a third party, so a question can carry injected text.

The execute prompts use the same rule for these untrusted tags: `approved-plan`, `todos`, `resolved-questions`,
`current-todo`, `verify-failure` and `verify-log`. The plan session wrote the plan, the todos and the questions from the
issue text of a third party. The verify failure and its log can quote code that the task wrote, and the output of that
code. The commit rules are not in a tag, because tasker writes them.

The findings in `earlier-reviews` of the review prompt and in `context` of the refine prompt are untrusted, because
earlier runs wrote them from the text of the branch. An error in `context` is untrusted too, because it can quote the
output of the commands of the branch. The block `branch-commits` of the refine prompt and the review prompt is
untrusted, because an execute run wrote it from the issue text of a third party.

The plan prompt puts the comments of the issue in the tag `issue-comments`. In the block `<comment-text-N>` of a
comment, `N` is the place of the comment in the list, from 1. Each comment has its own author, so each comment stands in
its own block, and no comment can end the block of another comment.

### What the plan prompt asks for

The plan must be complete on its own. The execute run is a new session. It sees only the plan, its todos and the answers
to the questions, not the planning conversation.

The list `files_changed` must name each file that the plan touches. Tasker compares this list with the other tasks in
flight to warn of merge conflicts. A missing file hides a conflict.

The todos come as red and green steps. The commit rules ask for a commit with the failing test, and then a commit with
the code.

A todo never runs the full check of the repository. Tasker runs the verify commands itself after the execute run, and
that run is the one that counts.

### The execute prompts

The execute run uses three prompts: `execute`, `execute-todo` and `execute-fix`. `tasker execute` sends them: `execute`
in the first turn of a new session, `execute-todo` for a todo and `execute-fix` for the fix turn.

The reasons for the design:

- One todo goes in each turn. Tasker records the state of each todo itself, and a resume continues at the next todo.
- The whole plan goes in the first turn only. One session holds it.
- The plan comes from the plan file. A fresh session has no memory of it.
- The todos and the resolved questions go in the prompt. The execute session never sees the planning conversation.
- The fix prompt spells out the rule texts and does not point at rule numbers. A fix turn can be the first turn of a
  resumed session, and that session never saw an `execute-todo` prompt.

The turn result is a strict object: `result` is `done` or `blocked`, and `reason` is a text or null. An extra key or an
unknown value is no result, and it is never read as `done`. The read of a result never throws. A `blocked` result with a
null or blank reason gets a fixed reason.

The todos run in the order of their dependencies. The plan check refuses a dependency cycle, so a new plan holds none. A
stored revision from before this check can hold a cycle, and for such a revision the function `orderTodos` throws. A
dependency on an id that no todo has holds nothing back, because the plan check already reports it.

### The refine prompt

Tasker reads the plan back from its plan file. As a result, the revision does not depend on how much of a long session
the assistant still remembers.

The context block says why the user asks for a revision and what tasker knows about the work. One template serves each
state, because each refine fills both blocks. The context holds one plain line, the open findings of a review, the
feedback line from the user about the committed work, or the origin and error of a failure. For reopen, it says that a
bug was found after acceptance and that the user needs a new complete plan revision. The feedback holds the words of the
user or `None.`.

The branch commits go in the prompt. An execute run is a separate session, so the refine session has not seen them.
Their work is done, and the revision plans only the work that is still needed.

The answer is a complete revision, never a list of changes. A change list leaves the execute run with only part of the
plan. The list `files_changed` covers the whole revision, for the same reason as in "What the plan prompt asks for".

The open questions keep their ids across rounds. As a result, an answered question drops out, and an open question stays
trackable.

The prompts share their common rules in one place in the code, for example the data sentence of each block. The turn
prompts of the execute run also share their text in one place. As a result, one change updates each of them.

### The review prompt and the findings answer

The review run is read-only, because the user decides each change.

The reasons for the design:

- The answer has no `questions` key, because nobody answers during the run. An open point becomes a finding.
- The earlier reviews go in the prompt. As a result, the review does not report a finding again that the user declined,
  and the user does not dismiss the same finding twice.
- The branch commits go in the prompt, because a read-only run needs no git command, and the diff is the thing under
  review.
- The prompt spells out the four simplify checks, so that they run the same under every assistant.

The schema does not restrict the value of `category`, so a run with another word does not fail. The schema lists each
key of a finding in `required`, and `line` and `category` take null, because Codex refuses a schema with an optional
key. The turn schema does the same for `reason`.

Each command that prints findings uses the same text form.

### The prompt version and the archive

Each step records the version of its prompt. The archive keeps each version. As a result, a prompt can change at any
time, and the history of earlier tasks stays exact.

The same version always has the same text. For this reason, a file that already exists counts as a success when the
archive writes a version. The archive writes a temp file and links it into place. As a result, a cut write never leaves
a partial version file, and a file that exists is always complete.

A prompt name never holds `@`. As a result, a name never looks like a version.

### The checks after the run

The checks after the run are plain code after a successful parse of the schema. They are not zod refinements, because a
zod refinement still runs after some issues of the schema ([code-conventions.md](code-conventions.md#zod)). As a result,
a refinement breaks the rule that a failed schema stops the checks.

### The JSON Schema

The JSON Schema for `claude` comes from the zod schema, so the rules of the shape have one home. The program `claude`
refuses a schema that holds `$schema`, so tasker removes that key.
