# Planning

This page gives the rules for a planning session. A planning session is the assistant session that plans a milestone and writes its issues on GitHub. The operator is the person who runs the planning session. The readers of this page are the planning session and its operator.

The page does not cover the work of the orchestrator and of the agents of the tickets. [orchestration.md](orchestration.md) holds that work and defines the terms "orchestrator", "ticket" and "agent".

[issues.md](issues.md) gives the steps and the GitHub facts to file issues, blocked-by links and milestones, and the facts of the project board.

A planning session is not the orchestrator. It is also not one of the sessions that tasker starts for plan, execute and review.

A blocked-by link is the GitHub link that says that one issue waits for another issue.

## The order of the work

- The planning session plans one milestone at a time. If the operator asks, the planning session writes the issues of the next milestone before the current milestone ends.
- The planning session first drafts all issues of the milestone and shows them to the operator. It posts nothing before the operator approves.
- If the request does not say which kinds of GitHub objects to make (milestones, issues, project items), the planning session asks the operator before a post. In one case, "post everything" meant milestones only, and the session made more than 100 unwanted issues.
- If a ticket that landed needs a change, the planning session writes a new follow-up issue. It does not edit the body of a closed issue.

## The body of an issue

- An issue is complete by itself. It gives the rules, the shapes, the signatures, the payloads, the lists and the edge cases that the work needs.
- The agent of a ticket uses no other source, as [the Limits of orchestration.md](orchestration.md#limits) say. [The design-gap rule](orchestration.md#run-one-ticket) says who answers a gap.
- An issue puts each table, list or diagram in its body. It does not say "as described elsewhere".
- Each issue has a "Docs" section. The section names each doc to update with the code. A Docs item asks only for what [rules.md](rules.md#docs) permits, and a new command goes where [rules.md](rules.md#docs) says.
- Each issue gives the scope hints that past tickets needed. [first-refine.md](first-refine.md) lists the hints by the kind of ticket. Examples:
  - The report of every configuration error in one run, as [rules.md](rules.md#code) says.
  - [The fact test](orchestration.md#run-one-ticket) for each fact about an outside tool.
- An issue body has no dependency text, for example no "Depends on" section. The blocked-by links hold the order.
- An issue needs no line for commit style, because the prompts of the installed tasker already name it. [rules.md](rules.md#commits) is the home of the commit rules.

## The blocked-by links

- The planning session links two issues when one issue needs the code or the docs that the other issue makes.
- The planning session also links two issues that will likely edit the same file, so that they do not cause a merge conflict. Examples are `skills/tasker/SKILL.md`, `docs/config.md`, `package.json`, the configuration schema, `docs/dev/code-conventions.md`, and a provider file with its dev doc.
- An edit of `test/helpers.ts` alone gets no blocked-by link.
- Before the links, the planning session makes a table of the needs and the likely files of each issue.
- A line of tickets that edit one provider and its dev doc is one chain. A ticket with its own folder runs in parallel and gets a blocked-by link only for a real need.
- The planning session gives each parallel line of work its own dev doc, so that the lines share no doc.
- An issue of an earlier milestone never waits for an issue of a later milestone. If the earlier milestone is one chain, the planning session links the later issue only to the last issue of that chain. After the links, the planning session reads every blocked-by link of both milestones and makes sure of this rule.
- The planning session gives the reasons for the links in the chat with the operator, not in the issue.

## The milestone of an issue

- A doc change goes in the ticket of the code that needs it, as [rules.md](rules.md#docs) says for the docs and the code.
- A docs-only issue goes in the milestone that it is about while that milestone is open. If that milestone is closed, or the issue is about no milestone, the issue goes in the milestone "Docs".
- GitHub holds the state of each issue and each piece of pending work. If the planning session defers a fix, it writes the fix as an issue in its later milestone at once. The fix does not stay in the notes of a session.

## What goes in a ticket

- The goal is the core features first. If a ticket finds an edge case, the edge case goes in a later issue, unless it is a security gap or a bug on the core path ([orchestration.md](orchestration.md#review-findings) defines both terms). The planning session does not ask the operator about each edge case.
- If the planning session finds a security gap, it tells the operator at once.
- If the operator states a design fact, the planning session puts the fact in a doc of the repo through a ticket, not in the notes of a session.
- tasker writes and reads UTF-8 only.
- Containers are out of scope.
- If two [issue keys](issue-keys.md) give the same folder name or the same branch name, the planning session does not raise it as a problem.

## Working with the operator

- Before the operator decides something, the planning session gives the context in plain text: what happened, why it matters, what each choice does, and a recommendation. The planning session defines each term that the operator has not seen, at its first use. A short popup with only a summary is not enough.
- If the planning session shows the list of milestones, it uses one table with the columns `#`, `Milestone` and `Description`, one row for each milestone, and "Future" last. Notes go below the table.
