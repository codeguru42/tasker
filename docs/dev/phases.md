# Phases

This page describes the phases of a task. A phase is a step in which tasker runs the commands of a repo in the worktree of a task. It gives the reasons for the design, the rules across files, the limits and the facts about outside tools.

## The environment of a phase

The environment of a phase starts empty. A command of a repo gets only the names that tasker allows and the names that the repo lists. A command gets only what it needs.

The same filter serves each phase.

Three rules apply to the environment:

- A name that is not set in the environment of tasker does not appear.
- The two Anthropic keys never pass, also when a repo lists them. A command of a repo never gets the credentials of the assistant.
- A name that starts with `TASKER_` never passes, also when a repo lists it. Such a name belongs to tasker.

## The deadline

One deadline covers the whole list of commands of a phase. The limit is for the phase, not for each command. A command that starts after the deadline gets the stop at once.

At the deadline, tasker sends SIGTERM to the command and to each child of the command. Five seconds later, it sends SIGKILL. The command can clean up in the first five seconds. A process that ignores SIGTERM cannot run on after SIGKILL.

## The process group

Each command runs in its own process group and session. This lets tasker stop each child of the command and not only the command itself.

SIGKILL has a case that SIGTERM does not have. The command can ignore SIGTERM, so the command can stay alive, and no exit comes. Then the process group still runs, and only a SIGKILL to the group stops it. The five seconds start at the SIGTERM for this reason. They do not wait for an exit.

Tasker does not wait for the exit of the command alone. After a deadline, it waits until the whole group is gone.

## The signals of tasker

While a command runs, tasker passes SIGINT and SIGTERM to the process group of the command. The group does not get the Ctrl-C of the terminal, because it has its own session. So tasker must send the signal.

The limits of this rule:

- While a command runs, a Ctrl-C does not stop tasker. The command gets the signal, and the run of the command ends. Tasker reports the stop as a failure of that command.
- Each signal that comes while the same command runs goes to the command. A second Ctrl-C reaches the command again.
- Between two commands, no handler exists. A Ctrl-C then stops tasker at once.
- After the run, the default comes back. A SIGTERM ends tasker.
- If tasker dies by SIGKILL, it cannot pass the signal. The process group of the command keeps running.

## The terminal and the output

A command has no terminal and no input. Its session has no controlling terminal, so a command that tries to open the terminal fails. A read from the input finds the end of the input at once.

The output of a command goes only to the log, and not to the terminal. The standard output and the standard error share one file. A shared file that is open for append keeps the exact order of both streams. With two separate pipes, the order is lost.

A command that succeeds can leave a child in the background. The child keeps running and can still write to the log. Tasker does not wait for it.

## The log and the marker

The log is append-only. A run again keeps the history of the earlier runs.

The marker records a finished run. A finished phase never runs twice. A phase that fails has no marker, so the next run starts again from the first command.

## Facts about outside tools

- While a program has a listener for SIGTERM, Node does not exit on SIGTERM. After the last listener is removed, the next SIGTERM ends Node with the status 143.
