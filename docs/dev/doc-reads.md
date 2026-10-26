# Doc reads

The readers of this page are the orchestrator, the agents, and the operator for the notice rule.

## The re-read rule

The orchestrator works from the current docs of the orchestrator. The docs of the orchestrator are `AGENTS.md`,
`docs/orchestrator.md`, the pages of the list "The pages" of [docs/orchestrator.md](../orchestrator.md),
`docs/sessions.md`, and the docs that the prompt of the orchestrator names. For example, a prompt can name
`docs/dev/rules.md`, `docs/dev/planner.md`, `docs/dev/issues.md`, `docs/dev/working-with-the-user.md`,
`docs/dev/first-refine.md` and `docs/dev/rebase-conflicts.md`. The last read is the commit of `origin/main` from which
the orchestrator last read the docs of the orchestrator.

At the start of its session, the orchestrator runs `git -C <local clone> fetch origin`, as
[the doc-read rule](#the-doc-read-rule) says. Then it runs `git -C <local clone> rev-parse --verify origin/main`. The
hash that this command prints is the first last read. Then the orchestrator reads the docs of the orchestrator, as the
doc-read rule says.

Each time a ticket lands, the orchestrator does these steps, at the place that the bullet "When the final report of the
agent of a ticket says that the ticket landed" of [Land the work](land-the-work.md#land-the-work) gives. The steps
change no task.

1. Run `git -C <local clone> fetch origin`, as [the doc-read rule](#the-doc-read-rule) says.
2. Read the tip of `main` one time: `git -C <local clone> rev-parse --verify origin/main`. This rule calls the hash
   `<tip>`.
3. Run `git -C <local clone> diff --name-only <last read>..<tip> -- AGENTS.md docs/ skills/`. The output lists each file
   that changed since the last read. If the output is empty, no doc changed, and the steps are complete. The last read
   stays.
4. Before the next step of your work, read again each file of the list that is a doc of the orchestrator, with
   `git -C <local clone> show <tip>:<path>`. A file of the list outside the docs of the orchestrator needs no read. If
   `AGENTS.md` or `docs/orchestrator.md` is on the list, also read, for the first time, each new doc that it names for
   the work of the orchestrator, with the same command. Then `<tip>` is the new last read.

If a command of [the doc-read rule](#the-doc-read-rule) fails before a doc read of the orchestrator,
[the failure rule](limits.md#the-failure-rule) applies. This applies to the first read at the start of the session and
to each later doc read. If a command of the steps above fails, the failure rule also applies. If the orchestrator must
read a doc, it then reads the doc with `git -C <local clone> show origin/main:<path>`, from the `origin/main` of the
last fetch that worked. Then the orchestrator continues its work. The last read stays. At the start of the session, the
orchestrator then runs `git -C <local clone> rev-parse --verify origin/main` before it reads the docs of the
orchestrator, and that hash is the first last read. The orchestrator does the steps above again at the next landing.

## The notice rule

This rule covers each ticket, whatever its milestone, also a ticket with no milestone. It applies when the landing of
the ticket changes a doc of the orchestrator of the ticket (see [the re-read rule](#the-re-read-rule)), for example
`docs/orchestrator.md`, or a page of the operator. A page of the operator is `docs/operator.md`, a page of its list "The
pages", or `docs/sessions.md`. A notice is a message about such a landing from the orchestrator of the ticket. For a
change of a doc of the orchestrator, the notice goes to the other orchestrators. For a change of a page of the operator,
the notice goes to each session whose name starts with `operator-`. The operator gives the session of each orchestrator
a name of the form `orchestrator-<milestone>`, as [Start a session](operator-start.md#start-a-session) says. For
example, `orchestrator-m6`, `orchestrator-m7` and `orchestrator-docs` are such names. The part after `orchestrator-` is
the first word of the milestone title in lowercase, for example `orchestrator-m9` for "M9 — Pauses and recovery" and
`orchestrator-docs` for "Docs". The other orchestrators are all the sessions with such a name except the session of the
orchestrator of the ticket. On 2026-10-25, before #561, #495 (M22 — Operator) changed `docs/dev/handoff-operator.md`,
and operator-docs got no notice.

The orchestrator of the ticket does these steps:

1. When the final report of the agent of the ticket arrives, read the files that landed in that report.
2. If no file of the report is a doc of the orchestrator of the ticket or a page of the operator, send no notice.
3. Read your own name from the first line of the output of `ListAgents`, as [sessions.md](../sessions.md) says. If a doc
   of the orchestrator changed, each session whose name starts with `orchestrator-`, except your own session, is another
   orchestrator. If a page of the operator changed, each session whose name starts with `operator-` also gets the
   notice. A session with another name, for example `planner-m7`, gets no notice.
4. Send one notice to each session of step 3 with `SendMessage`. Take the landed commit and the sections that changed
   from the same report. The notice names them in one or two lines.

   For example: Landed `<commit>` on `main`. `docs/dev/run-one-ticket.md` changed in "Run one ticket", and
   `docs/dev/land-the-work.md` changed in "Land the work".

The notice does not depend on the re-read rule. If the re-read rule fails at this landing, the orchestrator of the
ticket still sends the notice, and [the failure rule](limits.md#the-failure-rule) applies, as the re-read rule says. If
the session list or a message fails, the failure rule applies, and the orchestrator of the ticket continues its work. A
session that does not answer gets no second notice. The re-read rule covers such an orchestrator at its next landing.

The notice is information. When the other orchestrator gets a notice, the other orchestrator does the steps of the
re-read rule before its next step. The other orchestrator takes the rule from the doc, not from the notice. When the
operator gets a notice, the operator does [the doc-read rule](#the-doc-read-rule) and then reads each changed page of
the operator again.

Each orchestrator has its own docs of the orchestrator, because each prompt names its own docs. `AGENTS.md`,
`docs/orchestrator.md`, the pages of its list "The pages" and `docs/sessions.md` are docs of each orchestrator.

The re-read rule and the notice rule do not cover the agents. Each new agent reads the docs when it starts.

## The agent notice

After a landing, the orchestrator tells each agent in flight which sections of its docs changed. On #486, #444 landed
while #486 ran and changed the order of the same-patch reads before `tasker update-branch`. The agent of #486 read the
diff of the docs on its own, with no rule that asked it to.

The docs of an agent are the docs that its prompt names for all the rules and for the change of its ticket, as
[The prompt of an agent](pick-the-tickets.md#the-prompt-of-an-agent) of `docs/dev/pick-the-tickets.md` says. These are
the docs of "[the base list](pick-the-tickets.md#the-prompt-of-an-agent)" and each file that the prompt names because
the ticket changes it. Such a file can be under `skills/`.

A file that the prompt names for another reason, for example as the source of a fact of a hint, is not a doc of the
agent. Each agent has its own docs, because each prompt names its own docs. The orchestrator takes the docs of an agent
from the prompt that it wrote for that agent.

An agent in flight is an agent of the orchestrator from its start until its
[final report](run-one-ticket.md#the-final-report) arrives. The term "running" of ["Terms"](quota.md#terms) in
`docs/dev/quota.md` keeps its own meaning. An agent in flight can be running or ended in the meaning of that page.

The agent notice covers each landing of a ticket of the orchestrator. The steps of the orchestrator come right after the
steps of [the notice rule](#the-notice-rule), as [Land the work](land-the-work.md#land-the-work) says.

1. When the final report of the agent says that the ticket landed, the orchestrator reads the files that landed in that
   report.
2. If no file of the report is a doc of an agent in flight, the orchestrator sends no agent notice for that landing.
3. Otherwise, the orchestrator sends one message with `SendMessage` to each agent in flight that has a file of the
   report among its docs. The message is the agent notice. It names the landed commit and each changed section of each
   doc of that agent, from the same report.

   For example: Landed `<commit>` on `main`. `docs/dev/run-one-ticket.md` changed in "The diff read", and
   `docs/dev/review-findings.md` changed in "Review findings".

When the orchestrator gets a notice of the notice rule from another orchestrator, it sends an agent notice too. It sends
it to each agent in flight that has a doc of the notice among its docs. The agent notice names each section of the
notice that is in a doc of that agent. If no section of the notice is in a doc of an agent in flight, the orchestrator
sends no agent notice.

The agent notice does not depend on [the re-read rule](#the-re-read-rule). If the re-read rule fails at this landing,
the orchestrator still sends the agent notice. [The failure rule](limits.md#the-failure-rule) of `docs/dev/limits.md`
applies, as the re-read rule says.

When an agent gets an agent notice, it reads each named doc again, as [the doc-read rule](#the-doc-read-rule) says. It
does this before its next command or tool call of its work. From then on, the agent follows the new text of the named
sections. A step that the agent already did stays done.

If the agent runs a long `tasker` command in the background, the read comes after the end of that command.

An agent can wait in a loop that reads a state. Examples are the "To wait" bullet of "Land the work",
[the CI wait](ci-wait.md#the-ci-wait) of `docs/dev/ci-wait.md` and the wait bullet of
[the command rules](tasker-commands.md#the-command-rules) of `docs/dev/tasker-commands.md`. Such an agent reads the
named docs again before its next read of the state. The limit of the wait does not change.

An agent can also wait with its turn ended. Examples are a wait for an answer under
[the answer-wait rule](limits.md#the-answer-wait-rule) of `docs/dev/limits.md`, and a wait in `quota_blocked` or
`interrupted`, as ["What the agent does"](quota.md#what-the-agent-does) of `docs/dev/quota.md` says. Such an agent reads
the named docs again. Then it ends its turn with an [interim final answer](limits.md#the-answer-wait-rule). It sends no
`SendMessage` and does not repeat its question or its report.

The first line of that interim final answer says that the answer is not the final report and names what the agent still
waits for. The orchestrator treats it as no answer and no next step, and the wait does not change. For the orchestrator,
each read that a rule gives after a report of an agent still applies.

If the fetch of the doc-read rule fails, an agent that does not wait stops and reports the error. The doc-read rule says
this for an agent. An agent that waits gives the error in its interim final answer, or in its next report, and keeps its
wait.

If a message of the orchestrator fails, the failure rule of `docs/dev/limits.md` applies, and the orchestrator continues
its work. The orchestrator sends no second agent notice for that landing. The agent notice needs no answer.

The agent notice is information. The agent takes each rule from the doc, not from the agent notice.

## The doc-read rule

The local clone holds the checkout of the user, for example a commit of a pre-release. The docs of the orchestration
come from `origin/main`, not from that checkout.

1. Before the orchestrator or an agent reads a doc, it runs `git -C <local clone> fetch origin`.
2. Then it reads each doc with `git -C <local clone> show origin/main:<path>`, in a Bash call. `<path>` is the path of
   the doc from the root of the repo, for example `docs/dev/limits.md`.

This read is an exception to the Read-tool bullet of
[The tools of a session](working-with-the-user.md#the-tools-of-a-session).

The rule has no branch check and no merge. The checkout of the local clone does not matter. `git show` needs no
checkout, so no branch check and no merge can fail.

A link in a doc that the reader follows is also a doc read. The reader resolves the relative path of the link against
the folder of the doc, and drops the part from `#` (the anchor). For example, the link `limits.md#the-failure-rule` in
`docs/dev/doc-reads.md` gives `docs/dev/limits.md`, and the link `../../README.md#install` in `docs/dev/setup.md` gives
`README.md`. Then the reader reads that path with the command of step 2. The Read tool and relative links work only on
files on disk. `git show` does not resolve `..`: `git show origin/main:docs/dev/../config.md` fails with
`fatal: path 'docs/dev/../config.md' exists on disk, but not in 'origin/main'`.

A read with the Read tool of a file in the local clone is not a doc read. That file can be of another commit.

If `git show` prints `fatal: path '<path>' does not exist in '<commit>'` or
`fatal: path '<path>' exists on disk, but not in '<commit>'`, the doc does not exist on that commit, and the reader has
nothing to read. That is an answer, not a failure.

Each doc read uses `origin/main` in one command, so [the shared-clone rule](limits.md#the-shared-clone-rule) needs no
hash read for it. A fetch of another session between two reads can give a newer doc of `origin/main`.

If the fetch fails, an agent [stops](limits.md#the-answer-wait-rule) and reports the error. For the orchestrator,
[the re-read rule](#the-re-read-rule) gives the failure path.
