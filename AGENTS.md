# Index of the docs

Each assistant session reads this index first and follows the link for each topic.

- [docs/dev/rules.md](docs/dev/rules.md): the rules of the repo (the check, test first, the commits, the docs, the test helpers, the code rules, plain English and `AGENTS.md`).
- [docs/dev/code-conventions.md](docs/dev/code-conventions.md): the layout, the steps to add a command, the imports and the tests.
- [docs/config.md](docs/config.md): the configuration.
- [docs/dev/data-root.md](docs/dev/data-root.md): the folders and the database.
- [docs/dev/version-control.md](docs/dev/version-control.md): the git code: the git boundary, how tasker uses git, the git environment, provision, the ssh key, the push guard, publish and land, the doctor checks and the repo slug.
- [docs/dev/doctor.md](docs/dev/doctor.md): the code that all doctor checks share: the timeout rules and the signal rule.
- [skills/tasker/SKILL.md](skills/tasker/SKILL.md): the commands.
- [docs/dev/rebase-conflicts.md](docs/dev/rebase-conflicts.md): the procedure when `tasker update-branch` reports a rebase conflict.
- [docs/dev/orchestration.md](docs/dev/orchestration.md): the rules for an orchestrator that runs tickets from the project board through the installed tasker.
- [docs/dev/workspaces.md](docs/dev/workspaces.md): the base branch and the workspace of a task: the forms, the source order of the resolve, the learned default, the guard, the branch name, and the reasons for the git flags of the diff and the reconcile.
- [docs/dev/issue-trackers.md](docs/dev/issue-trackers.md): the issue tracker code: the gh boundary, the gh token and environment, the gh and GitHub facts that the code guards against, and the doctor checks.
- [docs/dev/issue-keys.md](docs/dev/issue-keys.md): the issue key forms, the short refs, the resolve of a key to its repo and the stored spelling.
- [docs/dev/tasks.md](docs/dev/tasks.md): the task commands start and abort: the purpose of start, the order of its steps, the locks and the lock order, the rules of a second run, the reasons of abort and the limits.
- [docs/dev/phases.md](docs/dev/phases.md): the phases: the environment of a phase, the deadline, the stop rules, the log and the marker.
- [docs/dev/assistants.md](docs/dev/assistants.md): the assistant provider interface: its purpose, the rule "refuse, never drop", the session id, the prompt on stdin and the provider of a new and a continued session.
