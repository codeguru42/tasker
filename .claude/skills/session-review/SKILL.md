---
name: session-review
description: Reviews the transcript of the session, saves what the session learned in memory, and sends each proposed change of a tracked doc to the target that the docs of the repo give. Start it with /session-review.
---

# session-review

This skill reviews the transcript of the session before the session ends.

## When to use

Run the skill only on a request, for example `/session-review` before `/clear` or before the end of a session.

The skill runs in a loop with the user before the clear. In the loop, the session answers the questions of the user and refines the proposed issues. In some cases, the session also writes a handoff file. The clear can come only after the loop ends.

## Steps

1. Find the candidates in the transcript. A candidate is a decision, a correction or a confirmation of how to work, a settled design tradeoff, or a state that changed. Examples of a state are a deadline, an owner and an outside reference.
2. Before the first write, read the memory index and each memory file. Then do two checks. The staleness check covers each existing entry: does each file, function or flag that it names still exist, and did a later decision of this session replace it? The duplicate check covers each new candidate: does an existing entry already hold it?
3. Write each new candidate to memory. Follow the memory rules of the system prompt of the session: the types, the frontmatter, the line in the index and the list of what not to save.
4. Update or remove each entry that step 2 found stale, wrong or duplicated.
5. If a candidate belongs in a tracked doc of the repo, make a proposal. A proposal names the file and the change. Find the docs of the repo from the index in `AGENTS.md`. Send each proposal to the target that these docs give for the role of the session. If the docs give no target for the role of the session, give each proposal to the user in the reply.
6. Report a short summary: the memory entries that the session made, changed or removed, and each proposal with its target.

## Rules

- Never edit a tracked doc, for example `AGENTS.md`, `CLAUDE.md` or a file under `docs/`. The reason: a tracked doc is shared with each contributor as soon as a commit holds it. A memory write is personal.
- Name no target for a proposal. The reason: the docs of the repo are the one home of that rule, and the rule changes.

## Common mistakes

| Mistake | What to do instead |
| --- | --- |
| The session skips the staleness check of the existing entries. | Do both checks of step 2. |
| The session edits a tracked doc. | Make a proposal, as step 5 says. |
| The session saves the state of a task in progress as memory. | Follow the list of what not to save, as step 3 says. |
| The session tries to start the skill from a hook. | Run the skill only on a request, as "When to use" says. |
| The session keeps a proposal only in its reply, but the docs give a target for its role. | Send the proposal to that target, as step 5 says. |
