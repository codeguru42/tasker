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

## The assistant runner

The runner of an assistant child follows the deadline, process group and signal rules of this page. An abort stops the group as the deadline does.

One rule differs from a phase command. A phase command can leave a background child alive. The assistant runner stops the whole group when the assistant exits. A background child holds the output open, and the run must end when the assistant ends. The assistant wrote its lines before it exited, so no line is lost. No background process of the assistant stays in the worktree. A process that leaves the group can hold the output open, so after the stop the runner closes its side of the pipes, and the output that such a process writes later is lost.

The prompt goes on the input of the assistant. [assistants.md](assistants.md#the-prompt) gives the reason. The runner closes the input after the write, so the assistant sees the end of the input. An assistant can exit before it reads the whole prompt. The write then fails, and tasker ignores the failure, because the result of the run comes from the exit.

The assistant writes one event on each line, and the provider parses each event. So the runner gives the output line by line. A pipe gives the output in chunks, and one event can be larger than a chunk. So the runner joins the chunks before the split. It decodes one UTF-8 stream, so a character that crosses a chunk border stays whole.

The error output does not go to the terminal. The runner keeps its last 64 KiB as the reason of a failure.

## The log and the marker

The log is append-only. A run again keeps the history of the earlier runs.

The marker records a finished run. A finished phase never runs twice. A phase that fails has no marker, so the next run starts again from the first command.

## Facts about outside tools

- While a program has a listener for SIGTERM, Node does not exit on SIGTERM. After the last listener is removed, the next SIGTERM ends Node with the status 143.
- Node reports a write to the input of a child that exited as an error event on that stream. With no listener, the error ends Node.
- The exit of a child comes before the end of its output. A background child that holds the output delays the end until it exits.
- Node gives the same error for a missing working folder and a missing program. A working folder that is a file makes the start fail at once, with no error event. So the runner checks the folder first.
- A pipe on Linux gives at most 64 KiB in one chunk.
- A process in a new session is not in the group, so a signal to the group does not reach it.
- A Node timer longer than 2^31-1 ms fires at once with a warning. So each timer of the deadline is at most that long.
