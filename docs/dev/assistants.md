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
