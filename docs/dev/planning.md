# Planning

This page gives the rules for a planning session. A planning session is the assistant session that plans a milestone and writes its issues on GitHub. The operator is the person who runs the planning session. The readers of this page are the planning session and its operator.

The page does not cover the work of the orchestrator and of the agents of the tickets. [orchestration.md](orchestration.md) holds that work and defines the terms "orchestrator", "ticket" and "agent".

[issues.md](issues.md) gives the steps and the GitHub facts to file issues, blocked-by links and milestones, and the facts of the project board.

A planning session is not the orchestrator. It is also not one of the sessions that tasker starts for plan, execute and review.

A blocked-by link is the GitHub link that says that one issue waits for another issue.

## The order of the work

- The operator decides when a milestone starts. The planning session plans one milestone at a time. If the operator asks, the planning session writes the issues of the next milestone before the current milestone ends.
- The planning session first drafts all issues of the milestone and shows them to the operator. It posts nothing before the operator approves.
- If the request does not say which kinds of GitHub objects to make (milestones, issues, project items), the planning session asks the operator before a post. In one case, "post everything" meant milestones only, and the session made more than 100 unwanted issues.
- If a ticket that landed needs a change, the planning session writes a new follow-up issue. It does not edit the body of a closed issue. If a closed issue has wrong text but right landed work, each session, not only the planning session, adds a comment to the issue. The comment names the wrong text and gives the right fact. The session does not edit the body. For this comment, the session also follows the first bullet of [Before a post](issues.md#before-a-post) of issues.md, so it shows the draft to the operator first. On #160, the Summary still named the latest review after the user removed the review from the requirements, and a comment recorded the fix.

## The body of an issue

- An issue is complete by itself. It gives the rules, the shapes, the signatures, the payloads, the lists, the edge cases, the states and the diagrams that the work needs.
- The agent of a ticket uses no other source, as [the Limits of orchestration.md](orchestration.md#limits) say. [The design-gap rule](orchestration.md#the-design-gap-rule) says who answers a gap.
- An issue puts each table, list or diagram in its body. It does not say "as described elsewhere". The plan session that tasker starts for a ticket sees only the issue and the repo. A phrase such as "the diagrams of the design" with no diagram is a gap.
- An issue can give a list or a table of the current behavior of the code. An example is a table of the commands that each state accepts. Before the post, the planning session makes sure that each row or item matches what the code does. The planning session gives the command that it used in the chat with the operator, for example a `grep` of the calls. On #215, the first table claimed to hold the commands of today. But it left out six of them, for example `refine` from `reviewed` and `finish` from `landed`. The agent found the gap with one `grep`, and the fix needed a stop and an edit of the issue body.
- An issue can give a value for a field of an existing event. Before the post, the planning session compares each such value with the form that the code stores in that field today. Examples of a form are a ref and a commit id. The issue gives the stored form, or it states the change of the form as a requirement with its own reason. For the command of the compare, the bullet before this one applies. An example is a `grep` of the writes of the event. On #273, step 5 said that the `revision` of the `base` event is the base tip, a commit id. The code stores a ref, `refs/remotes/origin/<base>`, and resolves it after each fetch. A commit id freezes the base tip. The agent stopped under the fifth case of [the stop rule](orchestration.md#the-stop-rule), and the user changed the scope with a comment.
- An issue that records an output of the installed tasker names the ticket and the date of the run that showed the output. When the agent cannot measure the output itself with [the fact test](orchestration.md#the-fact-test), the ticket and the date are its evidence for [the issue check](orchestration.md#the-issue-check). On #240, the agent was unable to measure the output of `tasker dismiss-review`, because no task of its own was in `reviewed`.
- An issue dictates each requirement. A requirement says what the software does. An issue can say why, as the purpose of the requirement. It gives no justification for a requirement and does not say where the requirement came from.
- Before the post, the planning session compares each reason in an example of the issue with the docs. A reason that no doc supports goes out of the example, or the issue states it as a requirement with its own reason. On #265, the Summary of the issue gave such a reason, the plan copied it, and review 1 found it.
- An issue that lists files to install names the source of each file. On #119, the plan asked where four skills come from, because the issue named only the target folder.
- An issue for a protocol or a procedure gives its state model: the actors, the states that each actor holds, and who tells whom when a state changes. An issue that gives only the target text draws a new gap in each review loop.
- If an issue asks the code to read a revision of a task, the issue names the revision: the tip of the task branch, or `HEAD` of the worktree. The issue also gives the exact ref of the read, for example `refs/heads/<branch>` in the clone of tasker. The two revisions differ when the worktree is not on the task branch. On #155, the issue said "the revision of the task", the code read `HEAD` of the worktree, but the user wanted the tip of the task branch. [The Revisions section of workspaces.md](workspaces.md#revisions) gives the rule of the exact ref reads.
- An issue names a git operation by its purpose and links to the doc section of the operation. It does not name the mechanism, for example "a plain push with no lease". On #178, #43 changed the mechanism after the draft of the issue, and a Docs item of the issue became stale.
- If an issue moves the members of a file by a table, the issue also says where a member goes that the table does not list: in the row of its kind. An example of such a move is the split of a file into one file for each kind. If no row fits, the plan asks a plan question. The reason: other tickets can add a member to the file between the draft of the issue and its start, and the plan follows an exact table. On #140, #94 landed after the draft of the issue and added three exports that the table did not list. The first refine placed them. #127 was in flight and added three more exports, and a second refine placed them after `tasker update-branch`.
- Each issue has a "Docs" section. The section names each doc to update with the code. A Docs item asks only for what [rules.md](rules.md#docs) permits, and a new command goes where [rules.md](rules.md#docs) says. When a doc must give the reason of a requirement, the Docs item states it as the content of the doc (for example "Give these reasons: ..."), not the Requirements. On 2026-10-17, an audit of M9 moved the reasons in the Requirements of #171, #172, #98 and #173 to the Docs item of each issue.
- A Docs item never asks for a sentence that says that no command uses a part yet. Such a sentence is false as soon as the next ticket wires the part, and that ticket must find and remove it. The rules of what a doc describes are in [rules.md](rules.md#docs). For a ticket that adds only a layer, the hint "Say that the wiring is out of scope" of [first-refine.md](first-refine.md#a-ticket-that-only-adds-a-layer-for-example-a-schema) covers the plan.
- Each issue gives the scope hints that past tickets needed. [first-refine.md](first-refine.md) lists the hints by the kind of ticket. Examples:
  - The report of every configuration error in one run, as [rules.md](rules.md#code) says.
  - [The fact test](orchestration.md#the-fact-test) for each fact about an outside tool.
- An issue body has no dependency text, for example no "Depends on" section. The blocked-by links hold the order.
- A planned issue gets no priority label. The blocked-by links hold the order of the work in a milestone. Only an issue outside the plan gets a priority label. An example is an issue of a failed CI run, as [A failed CI run](orchestration.md#a-failed-ci-run) of orchestration.md says.
- An issue needs no line for commit style, because the prompts of the installed tasker already name it. [rules.md](rules.md#commits) is the home of the commit rules.

## The blocked-by links

- The planning session links two issues when one issue needs the code or the docs that the other issue makes.
- The planning session also links two issues that will likely edit the same file, so that they do not cause a merge conflict. Examples are `skills/tasker/SKILL.md`, `docs/config.md`, `package.json`, the configuration schema, `docs/dev/code-conventions.md`, and a provider file with its dev doc.
- A ticket that changes the form or the layout of a file goes early in its chain. Each open ticket that edits that file is blocked by it, also a ticket of a later milestone, so that each of them writes the new form. This bullet gives the direction of the link of the bullet before it. The bullet "An issue of an earlier milestone never waits ..." wins for a ticket of an earlier milestone. A ticket of a later milestone gets this link also when it waits for the last issue of a chain. Before the planning session adds a blocked-by link to an open issue, it runs `tasker status`. The issue is in flight when the output lists a task for it. The planning session adds no link to an issue in flight, because the task already builds on the old form. The planning session tells the operator, and the orchestrator of the task decides what the ticket does with the change.
- An edit of a file under `test/helpers/` alone gets no blocked-by link.
- Before the planning session drafts the issues of a milestone, it makes a table of the needs and the likely files of each issue. It adds the links from the table when it posts the issues, after the operator approves the drafts.
- A line of tickets that edit one provider and its dev doc is one chain. A ticket with its own folder runs in parallel and gets a blocked-by link only for a real need.
- The planning session gives each parallel line of work its own dev doc, so that the lines share no doc.
- An issue of an earlier milestone never waits for an issue of a later milestone. If the earlier milestone is one chain, the planning session links a shared-file overlap only to the last issue of that chain. After the links, the planning session reads every blocked-by link of both milestones and makes sure of this rule.
- The planning session gives the reasons for the links in the chat with the operator, not in the issue.

## The milestone of an issue

- Each provider gets its own milestone. That milestone holds the interface and the whole provider. A command milestone only connects commands to the providers.
- A doc change goes in the ticket of the code that needs it, as [rules.md](rules.md#docs) says for the docs and the code.
- A docs-only issue goes in the milestone that it is about while that milestone is open. If that milestone is closed, or the issue is about no milestone, the issue goes in the milestone "Docs" (number 21). The tickets of "Docs" have no order with the numbered milestones.
- GitHub holds the state of each issue and each piece of pending work. If the planning session defers a fix, it writes the fix as an issue in its later milestone at once.

## What goes in a ticket

- What goes together in one ticket depends on logic, never on size. Two pieces of work never go together only because they are small. If they are not logically related, they go in two separate tickets. One large piece of work can be split into smaller, coherent tickets. Each smaller ticket must still hold work that is logically connected.
- [Core features first](working-with-the-user.md#core-features-first) gives the rules for the core features, an edge case, a security gap, containers, UTF-8 and a collision of derived names.
- If the operator states a design fact or a rule, the planning session puts it in a doc of the repo through a ticket: in the plan of a ticket in progress (before `tasker approve` when possible), in the body of a ticket that has not started, or in a new issue.
- The work on this repo must continue on any machine. For this reason, the notes of an assistant hold nothing that a session on another machine needs. This includes the preferences of the operator about how to work. Each new rule, fact or preference goes to a doc of the repo, as the bullet before this one says.

## Working with the operator

- Before the operator decides something, the planning session follows [A decision of the user](working-with-the-user.md#a-decision-of-the-user) of working-with-the-user.md.
- If the planning session shows the list of milestones, it uses one table with the columns `#`, `Milestone` and `Description`, one row for each milestone, and "Future" last. The description in each row is the description of the milestone on GitHub. Notes go below the table.
- The operator names the session of a planning session `planner-<milestone>`, for example `planner-m7`. The name tells the operator which session is the planning session and which session is an orchestrator. For example, on 2026-10-15, the operator confused a planning session with the orchestrator. [The notice rule](orchestration.md#the-notice-rule) says which sessions get a notice.
