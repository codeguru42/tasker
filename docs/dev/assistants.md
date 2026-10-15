# Assistants

An assistant is a coding-agent program. Tasker starts it in the worktree of a task to plan, to execute and to review. The assistant interface lets tasker run each assistant program in the same way. A command never imports the module of one assistant.

## Refuse, never drop

A provider that cannot enforce a limit that tasker asks for must refuse the run before it starts the program. A run with less confinement than tasker asked for can write or read outside the limits that the operator relies on. The doc comment of the interface holds the rule for the code.

## The session id

The caller must make the session id and must record it before the run. As a result, a crash, a timeout or a quota stop still leaves an id to continue. No provider has to report an id.

## The prompt

A provider must send the prompt on stdin, never in argv. A prompt can be longer than the argv limit of the system.

## New and continued sessions

A new session uses the provider, the model and the effort of the configuration. A continued session must use the provider, the model and the effort that it recorded when it started, also after the configuration changed. The session and its context belong to that assistant and that model. A change of the configuration applies to new sessions only.

## The limits of each role

A task runs the assistant in one of three roles: plan, execute or review. The plan and review roles share one set of limits and differ only in their model. The execute role has its own limits, because it does more steps than the other two.

### The plan and review roles

These roles run in the plan mode. They get no sandbox and no tool rule, except the deny rule that blocks `git push` for the shell. The deadline is the plan deadline of the configuration.

The plan mode blocks `Edit` and `Write`, but it does not block a shell command that writes. A host test on `claude` 2.1.300 showed this. Tasker relies on the plan mode for the plan and review roles for now.

### The execute role

The execute role runs under the `dontAsk` permission mode. Under this mode, a tool call that no allow rule covers is denied. The deadline is the execute deadline of the configuration.

The allow list holds these rules, in this order:

- `Read`, `Glob` and `Grep`, each limited to the worktree.
- `Edit` and `Write`, each limited to the worktree.
- The shell, which runs in the sandbox.

`Read`, `Glob` and `Grep` need a path rule. A plain `Glob` or `Grep` lists and searches files outside the worktree. A host test showed this. With a path rule, a call outside the worktree is denied. Without any `Glob` or `Grep` rule, the tools are not available at all.

The deny list blocks `Edit` and `Write` for the `.git` entry of the worktree and for the shared git folder of the clone. A deny wins over an allow. As a result, git data changes only through `git` commands in the sandboxed shell.

The sandbox follows the rules in [Sandbox](#sandbox). Its write paths and its shared folder come from the version control. Its read deny list holds these paths:

- The ssh key of every configured repo. The version control gives it.
- The `.ssh` folder of the operator.
- The folder of the `gh` configuration.
- The git credentials file and the `.netrc` file.
- The credentials file of Claude Code.
- The folder of the publish tokens of every configured repo. The version control gives it.
- The configuration of tasker.

With the key of any repo, the shell can push to that repo, because the network stays open. This is the reason for the items of every configured repo in the list. Each path of the list is absolute, because the shell runs in the worktree.

Each entry goes in only when the variables that name it are set. A path that does not exist still goes in the list. The `claude` program reads its own credentials outside the sandbox, so the list denies only the shell.

### The environment of the shell

The filter of the phases drops the GitHub token and the ssh agent of the operator (see [phases.md](phases.md)). As a result, the shell of the assistant has no GitHub token and no ssh agent of the operator. The read deny list adds the ssh key and the publish tokens of every configured repo, so the shell cannot read them either.

### The limits of these roles

- The network stays open.
- The assistant can read files that the lists do not name.
- The plan mode lets the assistant write its plan file under the configuration folder of `claude`, outside the worktree.

### The rules for the caller

- The caller must move the task into a spawning state before the run starts.
- The caller must record the session before the run starts.
- For the execute role, the caller must build the prompt with the commit text that the run gives, and must replace the base ref placeholder in it.

## The claude-code provider

The provider runs Claude Code in print mode. It sends the prompt on stdin and reads one event from each line of stdout. It makes no budget in money, because a money budget means nothing on a subscription.

### Arguments

`claude` refuses the streaming output format in print mode unless verbose output is on. The provider always turns it on.

Each tool rule goes as its own argument, so a rule with a space stays one rule. The host measure showed this. The two tool lists take any number of values, so they come last. The prompt cannot follow them, and it goes to stdin.

In a test by hand on the local machine, write `--allowedTools=Bash`, and send the prompt on stdin or close stdin with `< /dev/null`. A plain `claude -p --allowedTools Bash "<prompt>"` reads the prompt as a tool name (`claude` 2.1.300).

The schema goes inline as JSON text. `claude` parses the argument as JSON, and a file path fails on its first character.

A continued session also gets the model. A host measure showed that a resume with a model runs the given model.

### The environment

The child gets the environment that [phases.md](phases.md) describes. This doc does not repeat the filter rules.

`CLAUDE_CONFIG_DIR` passes the filter on purpose. It locates the configuration of the child: its credentials, its trust of folders and its settings. Without it, the child falls back to `$HOME/.claude.json`, not the folder that the operator set.

A stray Anthropic key is a risk. With such a key, `claude` bills the API and not the subscription, and it gives no error. The filter drops these keys for this reason.

### The stream

Each event is one JSON object on one line. A kill or a deadline can leave a cut last line. The provider drops a line that does not parse and keeps the events before it.

The `init` event names the requested model, and this is not always the model that ran. A measure under the plan permission mode showed the difference. Only `init` keeps the `[1m]` suffix of a long-context model. Subagent messages and `<synthetic>` messages do not name the model of the main thread, so the provider skips them.

The model usage of the `result` event adds up each model of the session, also of earlier runs.

`claude` splits one API message into several `assistant` events with the same message id and the same usage. The output count of these events is an early snapshot. As a result, only the `result` event gives exact totals. The result of a continued run covers only that run.

Permission denials can come with the error flag set. A denied tool does not always end the run in an error.

### Sandbox

A run with a sandbox keeps the shell of the assistant inside limits. The shell can write only to the worktree, a temp folder and the write paths of the caller. It cannot read the deny paths of the caller. The provider passes these limits to `claude` as inline settings.

Each setting has a reason:

- `claude` must refuse to start when it cannot build the sandbox. A run with less confinement is the case that "refuse, never drop" forbids.
- A command must never leave the sandbox. The setting that allows this is off. The schema of `claude` says that a command which asks to leave the sandbox is then ignored, and tasker relies on that text. No host test ran this case.
- The network stays open to all domains, because the assistant must reach its own service and the package hosts.
- The write and deny paths are those of the caller, and the provider adds none.

The provider refuses a sandbox before it starts the program in three cases:

- The platform is not Linux or macOS.
- The platform is Linux, and `bwrap` or `socat` is not on the `PATH` of the child.
- The shared git folder of the worktree has a name that ends in `.git`. The reason is in [version-control.md](version-control.md#sandbox-write-paths).

On Linux, `bwrap` comes from the `bubblewrap` package, and `socat` has its own package. The setting that makes `claude` fail when the sandbox is not available is the second guard, behind the check of the provider.

The only Unix socket that a command can use is the folder `claude-<uid>` in the temp root, as a real path. `claude` keeps its own sockets there. The provider never opens all Unix sockets, because that would open the sockets of the ssh agent and the keyring. When this folder is a shared temp folder, or holds one, the provider gives no socket rule. Then no command can use a Unix socket. When the provider cannot resolve the folder, the run fails before the start, and the reason holds the error code and no path. macOS uses this rule. Linux ignores it, because `seccomp` cannot filter by path.

The sandbox can always write the folder `claude-<uid>` in the temp root (`/tmp/claude-<uid>`). So a test of the sandbox on the local machine runs outside that folder (`claude` 2.1.300).

The sandbox leaves placeholder files in the worktree. `bwrap` makes an empty read-only file for each protected path that does not exist, for example `.bashrc`, `.mcp.json` and some entries of `.claude/`. A killed `claude` does not clean them, and a normal exit still leaves `.claude/.cc-writes` and `.claude`. Measures on `claude` 2.1.289 and 2.1.299 gave the same lists.

After each sandboxed run that reached the start, the provider removes these placeholders. It removes a path only when git does not track it and the path is an empty file with a read-only mode and one link, or an empty folder. The cleanup follows no symlink, also not in a parent folder. When `.claude` is a symlink, the cleanup leaves it and each entry of its target. A file with data and any other name stay. The outcome lists the removed paths, or the error. The cleanup never changes the kind of the outcome. A refused run starts nothing, so it has no cleanup.

The limits of the sandbox:

- The network stays open.
- Only the shell of the assistant is in the sandbox. The `claude` program is not.
- A shell command can write `objects/`, `refs/` and `logs/` of the clone, because `git commit` needs them. See the known limit in [version-control.md](version-control.md#sandbox-write-paths).
- While a sandboxed run is live, a placeholder `config.lock` in the bare clone makes the provision of another task in the same repo fail.
- After a kill of `claude`, the bare clone keeps `config.lock`, `.mcp.json` and an empty `.claude/` folder. A later write to the configuration of the clone fails until a later change removes them. The cleanup covers the worktree only.
- A later `claude` can widen the write list in a way that the guard of the `.git` name does not catch. The guard follows `claude` 2.1.299.

### Quota

When a rate limit stops a run, the last event is a `result` with `terminal_reason: "api_error"` and `api_error_status: 429`. `claude` exits with a code other than 0. The `subtype` and `stop_reason` of that result say `"success"` and `"stop_sequence"`. These values are decoys, so the provider does not read them. The text of the last turn gives the reset in local time with no date, so the provider does not read it either. The reset time comes from the rejected rate-limit event.

A quota outcome wins over a failure, because the next step is a resume, not a fix.

Paid usage (overage) is usage past the subscription quota, and it costs money. The caller must pass the overage stop only under `overagePolicy: "decline"`. The caller must pass the reset time of the window that the operator approved. An event in that window does not stop the run. An overage stop ends the child at once. Its outcome wins over the timeout, because it rests on the parsed event, not on whether the stop beat the exit of the child.

An event shows the start of paid usage when `isUsingOverage` is `true`, or when `status` is `rejected` and `overageStatus` is `allowed` or `allowed_warning`. In the second case, the subscription is spent and paid usage is on. A high `utilization` alone does not show it. The presence of `overageStatus` does not show it, and neither does `overageStatus: "rejected"`, because an `allowed` event can carry `overageStatus` too. With paid usage off, the stop comes through the quota stop.

The events have these facts:

- Under `rateLimitType: "overage"`, the flat use and reset time describe the cap of paid usage, not the spend of the subscription. A capture showed `utilization: 0.99` there while `isUsingOverage` was `false`.
- `unifiedWindows` is missing in older captures. A real `allowed` event has no flat use, so the entry of the window must win.
- The last warning window counts, not the highest. A run can pass into a new window, and the high use of the old window must not hide the new one.
- A warning with no reset time never matches an approval, so the pause comes again.
- A field can be missing or not a number. A bad event never throws.

### Limits

Tasker keeps the events itself, so the provider has no transcript path.

No real capture shows the start of paid usage. This rule of the start of paid usage is the best known form. The stream can report paid usage only after the first paid request, so one paid request can pass before the stop.

### Doctor checks

The version check is required. It runs once for all repos of the provider. On Linux, two more required checks make sure that `bwrap` and `socat` are on `PATH`. Each missing program (`claude`, `bwrap` or `socat`) gets the fix to install it, because only an install fixes that cause. Other causes, such as a failed run of the program, get no fix.

The model check of a continued session uses the model forms of the configuration. It holds no second rule.

## The plan answer and the prompts

### The untrusted tag

An untrusted value, such as the text of an issue, stands in its own tag in the prompt. The tag lets the assistant tell data from instructions. A third party wrote the value, so the value cannot give orders.

The fill makes the closing tag of that tag harmless inside the value. Without this step, the value ends the block early and puts its own instructions after it.

The plan and the feedback of a refine run also stand in a tag, and the fill treats them in the same way. They are not text of a third party, but the tag keeps each block clear.

The open questions of a refine run also stand in an untrusted tag. The plan session writes them after it reads the issue text of a third party, so a question can carry injected text.

### What the plan prompt asks for

The plan must be complete on its own. The execute run is a new session. It sees only the plan, its todos and the answers to the questions, not the planning conversation.

The list `files_changed` must name each file that the plan touches. Tasker compares this list with the other tasks in flight to warn of merge conflicts. A missing file hides a conflict.

The todos come as red and green steps. The commit rules ask for a commit with the failing test, and then a commit with the code.

A todo never runs the full check of the repository. Tasker runs the verify commands itself after the execute run, and that run is the one that counts.

### The refine prompt

Tasker reads the plan back from its plan file. As a result, the revision does not depend on how much of a long session the assistant still remembers.

The branch commits go in the prompt. An execute run is a separate session, so the refine session has not seen them. Their work is done, and the revision plans only the work that is still needed. The commits are untrusted, because an execute run wrote them from the issue text of a third party.

The answer is a complete revision, never a list of changes. A change list leaves the execute run with only part of the plan. The list `files_changed` covers the whole revision, for the same reason as in "What the plan prompt asks for".

The open questions keep their ids across rounds. As a result, an answered question drops out, and an open question stays trackable.

The two prompts share their common rules in one place in the code. As a result, one change updates both.

### The prompt version and the archive

Each step records the version of its prompt. The archive keeps each version. As a result, a prompt can change at any time, and the history of earlier tasks stays exact.

The same version always has the same text. For this reason, a file that already exists counts as a success when the archive writes a version. The archive writes a temp file and links it into place. As a result, a cut write never leaves a partial version file, and a file that exists is always complete.

A prompt name never holds `@`. As a result, a name never looks like a version.

### The checks after the run

The checks after the run are plain code after a successful parse of the schema. They are not zod refinements, because a zod refinement still runs after some issues of the schema ([code-conventions.md](code-conventions.md#zod)). As a result, a refinement breaks the rule that a failed schema stops the checks.

### The JSON Schema

The JSON Schema for `claude` comes from the zod schema, so the rules of the shape have one home. The program `claude` refuses a schema that holds `$schema`, so tasker removes that key.
