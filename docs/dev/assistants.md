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

## The claude-code provider

The provider runs Claude Code in print mode. It sends the prompt on stdin and reads one event from each line of stdout. It makes no budget in money, because a money budget means nothing on a subscription.

### Arguments

`claude` refuses the streaming output format in print mode unless verbose output is on. The provider always turns it on.

Each tool rule goes as its own argument, so a rule with a space stays one rule. The host measure showed this. The two tool lists take any number of values, so they come last. The prompt cannot follow them, and it goes to stdin.

The schema goes inline as JSON text. `claude` parses the argument as JSON, and a file path fails on its first character.

A continued session also gets the model. A host measure showed that a resume with a model runs the given model.

### The environment

The child gets the environment that [phases.md](phases.md) describes. This doc does not repeat the filter rules.

The config folder name passes the filter, because it locates the configuration of the child: its credentials, its trust of folders and its settings. Without it, the child falls back to the configuration file in the home folder.

A stray Anthropic key is a risk. With such a key, `claude` bills the API and not the subscription, and it gives no error. The filter drops these keys for this reason.

### The stream

Each event is one JSON object on one line. A kill or a deadline can leave a cut last line. The provider drops a line that does not parse and keeps the events before it.

The `init` event names the requested model, and this is not always the model that ran. A measure under the plan permission mode showed the difference. Only `init` keeps the `[1m]` suffix of a long-context model. Subagent messages and `<synthetic>` messages do not name the model of the main thread, so the provider skips them.

The model usage of the `result` event adds up each model of the session, also of earlier runs.

`claude` splits one API message into several `assistant` events with the same message id and the same usage. The output count of these events is an early snapshot. As a result, only the `result` event gives exact totals. The result of a continued run covers only that run.

Permission denials can come with the error flag set. A denied tool does not always end the run in an error.

### Limits

The provider has no sandbox and no quota detection yet. It refuses a sandbox and an overage stop before it starts `claude`. Tasker keeps the events itself, so the provider has no transcript path.

### Doctor checks

The version check is required. It runs once for all repos of the provider. Only a missing `claude` gets the fix "install Claude Code", because an install fixes only that cause. Other causes, such as a failed run of the program, get no fix.

The model check of a continued session uses the model forms of the configuration. It holds no second rule.
