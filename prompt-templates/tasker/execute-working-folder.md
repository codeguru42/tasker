---
name: execute-working-folder
description: Load this template when you write the execute-todo or execute-fix prompt that uses it.
placeholders: {}
---
Your working folder is already the worktree of the task, and each command starts there. Run commands from it with relative paths. Never `cd` to the absolute path of the worktree, and never pass that path to `git -C`. The settings of the assistant of the user can deny those forms, also when the same command without them runs.